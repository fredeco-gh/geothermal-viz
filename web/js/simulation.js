/**
 * GeothermalViz Simulation Panel
 *
 * Handles the right-side simulation panel for setting up a Fimbul.jl
 * geothermal simulation from well metadata and sending it off to run.
 *
 * Parameter resolution (well metadata -> defaults) still happens on this
 * app's own Julia backend (/api/simulation/setup). Actually *running* the
 * simulation happens on jutul-agent's Julia kernel instead: clicking Run
 * relays the case type and parameters to the agent (see
 * js/jutul-agent-bridge.js), and progress/results show up in the chat, not
 * in this panel — there is no "Results" tab here anymore.
 */

// ── Well types that support simulation ───────────────────────────────────────
const SIMULATABLE_LAYERS = new Set(["EnergiBrønn", "BrønnPark"]);

// ── Simulation State ─────────────────────────────────────────────────────────
const simState = {
    currentSetup: null,   // Current simulation parameter set from backend
    isRunning: false,
    lngLat: null,         // { lng, lat } of the currently-setup well
};

// ── Initialisation ───────────────────────────────────────────────────────────

function initSimulationPanel() {
    document.getElementById("btn-setup-sim").addEventListener("click", () => {
        openSimPanel();
    });

    document.getElementById("btn-close-sim").addEventListener("click", () => {
        closeSimPanel();
    });

    document.getElementById("btn-run-sim").addEventListener("click", () => {
        runSimulation();
    });
}

// ── Panel open/close ─────────────────────────────────────────────────────────

async function openSimPanel() {
    const feature = window.GeothermalViz.state.selectedFeature;
    if (!feature) return;

    const props = feature.properties;
    const layerName = props.layer || "";
    if (!SIMULATABLE_LAYERS.has(layerName)) return;

    // Store well coordinates for 3D visualisation
    const coords = feature.geometry.coordinates;
    simState.lngLat = { lng: coords[0], lat: coords[1] };

    // Fetch simulation setup from Julia backend
    try {
        const resp = await fetch(`/api/simulation/setup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(props),
        });
        const setup = await resp.json();

        if (!setup.simulatable) {
            return; // Should not happen given SIMULATABLE_LAYERS check, but be safe
        }

        simState.currentSetup = setup;
        renderSimSetup(setup);
        document.getElementById("sim-panel").classList.add("open");

        // Emit event so the 3D wellbore layer can activate
        emitEvent("simulationSetup", {
            lngLat: simState.lngLat,
            params: setup.parameters,
            caseType: setup.case_type,
        });

        // Listen for parameter changes and relay to 3D visualisation
        let paramTimer = null;
        document.querySelectorAll("#sim-params .sim-param-input").forEach(input => {
            input.addEventListener("input", () => {
                clearTimeout(paramTimer);
                paramTimer = setTimeout(() => {
                    emitEvent("simulationParamChange", { params: collectParams() });
                }, 150);
            });
        });
    } catch (err) {
        console.error("Failed to fetch simulation setup:", err);
    }
}

function closeSimPanel() {
    document.getElementById("sim-panel").classList.remove("open");
    emitEvent("simulationClosed", {});
}

// ── Show "Setup Simulation" button only for simulatable wells ────────────────

function showSimButton(feature) {
    const layerName = (feature && feature.properties && feature.properties.layer) || "";
    if (SIMULATABLE_LAYERS.has(layerName)) {
        document.getElementById("sim-setup-action").style.display = "block";
    } else {
        document.getElementById("sim-setup-action").style.display = "none";
    }
}

function hideSimButton() {
    document.getElementById("sim-setup-action").style.display = "none";
}

// ── Render simulation setup form ─────────────────────────────────────────────

function renderSimSetup(setup) {
    // Case info
    const caseInfo = document.getElementById("sim-case-info");
    caseInfo.innerHTML = `
        <div class="sim-well-id">${setup.well_id}</div>
        <div class="sim-case-badge">${setup.case_label}</div>
        <p class="sim-case-desc">${setup.case_description}</p>
    `;

    // Parameters grouped by metadata group
    const paramsEl = document.getElementById("sim-params");
    const groups = {};

    for (const key of setup.parameter_order) {
        const meta = (setup.metadata && setup.metadata[key]) || { label: key, unit: "", group: "Other" };
        const group = meta.group || "Other";
        if (!groups[group]) groups[group] = [];
        groups[group].push({ key, meta });
    }

    let html = "";
    for (const [groupName, items] of Object.entries(groups)) {
        html += `<div class="sim-param-group"><h3>${groupName}</h3>`;
        for (const { key, meta } of items) {
            const value = setup.parameters[key];
            const source = setup.sources[key];
            const sourceClass = source === "data" ? "source-data" : "source-default";
            const sourceLabel = source === "data" ? "from well data" : "default";
            html += `
                <div class="sim-param-row">
                    <label for="sim-p-${key}">
                        ${meta.label}
                        <span class="sim-param-unit">${meta.unit}</span>
                    </label>
                    <div class="sim-param-input-wrap">
                        <input type="number" id="sim-p-${key}" data-param="${key}"
                               value="${value}" min="${meta.min}" max="${meta.max}" step="${meta.step}"
                               class="sim-param-input">
                        <span class="sim-param-source ${sourceClass}" title="${sourceLabel}">
                            ${source === "data" ? "📊" : "⚙️"}
                        </span>
                    </div>
                </div>
            `;
        }
        html += `</div>`;
    }
    paramsEl.innerHTML = html;

    // Reset status
    document.getElementById("sim-status").style.display = "none";
    document.getElementById("sim-panel-title").textContent = `Simulation — ${setup.well_id}`;
}

// ── Collect current parameters from the form ─────────────────────────────────

function collectParams() {
    const params = {};
    document.querySelectorAll("#sim-params .sim-param-input").forEach(input => {
        params[input.dataset.param] = parseFloat(input.value);
    });
    return params;
}

// ── Run simulation: hand it off to the agent ─────────────────────────────────

function runSimulation() {
    if (simState.isRunning || !simState.currentSetup) return;

    const statusEl = document.getElementById("sim-status");
    statusEl.style.display = "block";
    statusEl.className = "sim-status running";
    statusEl.textContent = "Sent to the agent — watch the chat for progress and results.";

    // jutul-agent-bridge.js relays this to the agent, which runs it on its own
    // Julia kernel with these exact parameters and reports back in the chat —
    // this app no longer runs or displays simulations itself.
    emitEvent("simulationRunRequested", {
        caseType: simState.currentSetup.case_type,
        parameters: collectParams(),
    });
}

// ── Hook into main app lifecycle ─────────────────────────────────────────────

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSimulationPanel);
} else {
    initSimulationPanel();
}

// Register as extension to react to well selection events
window.addEventListener("load", () => {
    if (window.GeothermalViz) {
        window.GeothermalViz.registerExtension({
            name: "SimulationPanel",
            onEvent(event, data) {
                if (event === "wellSelected") {
                    showSimButton(data.feature);
                }
            }
        });
    }
});
