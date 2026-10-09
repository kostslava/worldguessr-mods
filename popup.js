const enabledInput = document.getElementById("enabled");
const placePinInput = document.getElementById("placePin");
const zoomMapInput = document.getElementById("zoomMap");
const minKmInput = document.getElementById("minKm");
const maxKmInput = document.getElementById("maxKm");
const minKmLabel = document.getElementById("minKmLabel");
const maxKmLabel = document.getElementById("maxKmLabel");
const autoGuessInput = document.getElementById("autoGuess");
const autoDelayInput = document.getElementById("autoDelay");
const autoDelayLabel = document.getElementById("autoDelayLabel");

const defaults = {
  enabled: false,
  placePin: true,
  zoomMap: true,
  minKm: 10,
  maxKm: 20,
  autoGuess: false,
  autoDelay: 3,
};

function showDistance(input, label) {
  label.textContent = `${input.value} km`;
}

function showDelay() {
  autoDelayLabel.textContent = `${autoDelayInput.value} s`;
}

function save() {
  let minKm = Number(minKmInput.value);
  let maxKm = Number(maxKmInput.value);
  if (minKm > maxKm) {
    if (document.activeElement === minKmInput) maxKm = minKm;
    else minKm = maxKm;
    minKmInput.value = String(minKm);
    maxKmInput.value = String(maxKm);
  }
  showDistance(minKmInput, minKmLabel);
  showDistance(maxKmInput, maxKmLabel);
  showDelay();
  chrome.storage.local.set({
    enabled: enabledInput.checked,
    placePin: placePinInput.checked,
    zoomMap: zoomMapInput.checked,
    minKm,
    maxKm,
    autoGuess: autoGuessInput.checked,
    autoDelay: Number(autoDelayInput.value),
  });
}

chrome.storage.local.get(defaults, (data) => {
  enabledInput.checked = Boolean(data.enabled);
  placePinInput.checked = data.placePin !== false;
  zoomMapInput.checked = data.zoomMap !== false;
  minKmInput.value = String(Number.isFinite(Number(data.minKm)) ? data.minKm : 10);
  maxKmInput.value = String(Number.isFinite(Number(data.maxKm)) ? data.maxKm : 20);
  autoGuessInput.checked = Boolean(data.autoGuess);
  autoDelayInput.value = String(Number.isFinite(Number(data.autoDelay)) ? data.autoDelay : 3);
  showDistance(minKmInput, minKmLabel);
  showDistance(maxKmInput, maxKmLabel);
  showDelay();
});

enabledInput.addEventListener("change", save);
placePinInput.addEventListener("change", save);
zoomMapInput.addEventListener("change", save);
minKmInput.addEventListener("input", save);
maxKmInput.addEventListener("input", save);
autoGuessInput.addEventListener("change", save);
autoDelayInput.addEventListener("input", save);
