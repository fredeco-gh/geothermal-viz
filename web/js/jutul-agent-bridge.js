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
 * Inbound: applies `ui` actions the agent sends, once an extension defines any
 * (no actions exist yet — this is the receiving scaffold for that later step).
 */
(function () {
    "use strict";

    const agentOrigin = new URLSearchParams(location.search).get("agent_origin");
    if (!agentOrigin) return; // not embedded by jutul-agent

    function sendToAgent(payload) {
        window.parent.postMessage(payload, agentOrigin);
    }

    // Inbound: apply a `ui` action from the agent. No actions exist yet; this is
    // where they'll be dispatched once a jutul-agent capability defines some
    // (e.g. setting the map view, highlighting a well).
    window.addEventListener("message", (event) => {
        if (event.origin !== agentOrigin) return;
        const msg = event.data;
        if (!msg || msg.type !== "ui") return;
        console.debug("[jutul-agent] ui action (unhandled):", msg.action, msg.payload);
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
