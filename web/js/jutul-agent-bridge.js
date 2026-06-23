/**
 * jutul-agent bridge
 *
 * Connects this page to the jutul-agent chat it's embedded next to, when opened
 * inside jutul-agent's canvas (see jutul-agent's examples/geothermal-viz-app).
 * Outside that embed (e.g. opened directly, or via geothermal-viz's own server
 * on its own page) this is inert: no agent_origin means no parent to talk to.
 *
 * Outbound: taps the existing GeothermalViz extension bus (the same one
 * SimulationPanel and Wellbore3D use) and relays relevant events to the parent.
 * Inbound: applies `ui` actions the agent sends, looked up in ACTIONS below.
 *
 * This is the skeleton's other half (see jutul-agent's
 * examples/geothermal-viz-app/capability.py): each tool defined there emits a
 * `ui` action by name, and ACTIONS is where that name gets a handler here. Adding
 * a new agent ability is a tool factory on the Python side plus one entry here.
 */
(function () {
    "use strict";

    const agentOrigin = new URLSearchParams(location.search).get("agent_origin");
    if (!agentOrigin) return; // not embedded by jutul-agent

    function sendToAgent(payload) {
        window.parent.postMessage(payload, agentOrigin);
    }

    // Finds the well feature whose well/park number matches `identifier` exactly
    // (case-insensitive), falling back to a substring match over a few
    // human-identifying fields (area name, description, contractor) so a vaguer
    // request ("the well near the Oslo park") still has a chance of resolving.
    function findWell(identifier) {
        const features = window.GeothermalViz?.state?.data?.features || [];
        const needle = String(identifier || "").trim().toLowerCase();
        if (!needle) return null;

        const exactFields = ["brønnNr", "brønnParkNr"];
        for (const feature of features) {
            if (exactFields.some((f) => String(feature.properties[f] ?? "").toLowerCase() === needle)) {
                return feature;
            }
        }

        const looseFields = [...exactFields, "brønnpOmrNavn", "beskrivelse", "oppdragstaker"];
        return (
            features.find((feature) =>
                looseFields.some((f) => String(feature.properties[f] ?? "").toLowerCase().includes(needle))
            ) || null
        );
    }

    // One handler per `ui` action name a jutul-agent tool can emit. Add a case
    // here for every new tool added in capability.py's _TOOL_FACTORIES.
    const ACTIONS = {
        set_map_view(payload) {
            const map = window.GeothermalViz && window.GeothermalViz.state.map;
            if (!map || !payload) return;
            map.flyTo({ center: [payload.lon, payload.lat], zoom: payload.zoom });
        },
        go_to_well(payload) {
            const identifier = payload && payload.identifier;
            const feature = findWell(identifier);
            if (!feature) {
                sendToAgent({ event: "goToWellNotFound", identifier });
                return;
            }
            const [lon, lat] = feature.geometry.coordinates;
            window.GeothermalViz.state.map.flyTo({ center: [lon, lat], zoom: 17 });
            // Reuses the same path a real click takes — its wellSelected event is
            // already relayed below, so the agent sees confirmation of where it
            // landed without a second, redundant message here.
            window.GeothermalViz.selectWell(feature, [lon, lat]);
        },
    };

    // Inbound: apply a `ui` action from the agent by dispatching it through ACTIONS.
    window.addEventListener("message", (event) => {
        if (event.origin !== agentOrigin) return;
        const msg = event.data;
        if (!msg || msg.type !== "ui") return;
        const handler = ACTIONS[msg.action];
        if (handler) handler(msg.payload);
        else console.debug("[jutul-agent] ui action (unhandled):", msg.action, msg.payload);
    });

    // Outbound: relay events already emitted on GeothermalViz's bus today.
    window.addEventListener("load", () => {
        if (!window.GeothermalViz) return;
        window.GeothermalViz.registerExtension({
            name: "JutulAgentBridge",
            onEvent(event, data) {
                switch (event) {
                case "wellSelected":
                    sendToAgent({
                        event: "wellSelected",
                        properties: data.feature.properties,
                        lngLat: { lng: data.lngLat.lng, lat: data.lngLat.lat },
                    });
                    break;
                case "simulationSetup":
                    sendToAgent({
                        event: "simulationSetup",
                        caseType: data.caseType,
                        params: data.params,
                    });
                    break;
                case "simulationParamChange":
                    sendToAgent({ event: "simulationParamChange", params: data.params });
                    break;
                case "simulationClosed":
                    sendToAgent({ event: "simulationClosed" });
                    break;
                }
            },
        });
    });
})();
