const sampleRate = 18000;
//const bufferSize = 4096;
//const bufferSize = 2048;
const bufferSize = 4096;
var scriptNode = null;
var socket = null;
var playfabId = null;
var audioCtx = null;
var loggedIn = false;
var currentRoom = "";
var localInit = false;
var socketEndpoint = "";
var currentVoicePassword = "";
var socketStats = null;
var speaking = false;
var platform = null;
var localMuteList = null;
var authCode = "";
var noiseSuppression = false;
var echoCancellation = false;
var localMediaStreamSource = null;
var inputDeviceId = 'default';
var localMediaStream = null;
var voiceEndpoint = "";
var currentRoom = "";

function getUrlParams() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('id')) canStart = true;
    playfabId = urlParams.get('id');
    platform = urlParams.get('platform');
    localMuteList = urlParams.get('mutelist');
    if (localMuteList && (typeof localMuteList === 'string' || localMuteList instanceof String)) {
        const localMuteListArr = localMuteList.split(",");
        localMuteListArr.forEach( function(playfab) {
            mutedPlayers.push(playfab);
        });
    }
    authCode = urlParams.get('code');
    voiceEndpoint = urlParams.get('endpoint');
    currentRoom = urlParams.get('room');

    const pan = urlParams.get('pan');
    const dist = urlParams.get('dist');
    const ref = urlParams.get('ref');
    const max = urlParams.get('max');
    const roll = urlParams.get('roll');
    // const delay = urlParams.get('delay');
    voiceSettings = { panningModel: pan, distanceModel: dist, refDistance: Number(ref), maxDistance: Number(max), rolloffFactor: Number(roll), coneInnerAngle: 360, coneOuterAngle: 0, coneOuterGain: 0 };

    //window.history.replaceState({}, document.title, window.location.pathname);
}

function launch() {
    if (platform == "steam" || platform == "Steam") {
        // const steamWindow = window.open(`steam://run/629760`);
        // setTimeout(() => {
        //     if (steamWindow.window != null) steamWindow.window.close();
        // }, 3500);
    }

    document.getElementById('main-box').classList = "load";
    audioCtx = new AudioContext();
    setTimeout(() => {
        document.getElementById('main-box').classList = "status";

        if (loggedIn)
            document.getElementById('tip2').style.display = 'block';
        else
            document.getElementById('tip2').style.display = 'none';
    }, 700);

    micSetup(true);
    socketSetup();
    receiverSetup();
    receiverSockets();
}

function socketSetup() {
    //socket = io("https://mordvoice.com:3040");
    socket = io("https://" + voiceEndpoint);

    socket.on('connect', () => {
        console.log('Connected to Mord Voice Server');
        socket.emit('login', { id: playfabId, code: authCode, room: currentRoom });
    });

    socket.on('disconnect', () => {
        speaking = false;
    });

    socket.on('on-login', (success) => {
        if (success) {
            document.getElementById('status-message').innerHTML = `Connected to <b>${currentRoom}</b>`;
            loggedIn = true;
            console.log(`Logged in: ${playfabId}`);
        }
        else {
            document.getElementById('status-message').innerHTML = `Invalid Credentials.`;
            loggedIn = false;
            console.log(`Failed to log in: ${playfabId}`);
        }
    });

    socket.on('kicked', () => {
        document.getElementById('status-message').innerHTML = `Session Expired.`;
        loggedIn = false;
        socket.disconnect();
        document.getElementById('tip2').style.display = 'none';
        console.log('Disconnected from Mord Voice Server');

        if (scriptNode != null)
            scriptNode.disconnect();
        if (localMediaStreamSource != null)
            localMediaStreamSource.disconnect();
        if (localMediaStream != null) {
            localMediaStream.getTracks().forEach(function(track) {
                track.stop();
            });
        }
        scriptNode = null;
        localMediaStreamSource = null;
        localMediaStream = null;
    });

    socket.on('talk', (talk) => {
        if (!loggedIn) return;

        if (talk == "true") {
            speaking = true;
            localInit = true;
        }
        else if (talk == "false")
            speaking = false;
        else
            console.log(`Unknown Talk Value: ${talk}`);
    });

    socket.on('new-code', (newCode) => {
        authCode = newCode;

        const urlParams = new URLSearchParams(window.location.search);
        urlParams.set('code', authCode);
        const url = new URL(window.location.href);
        url.search = urlParams.toString();
        window.history.replaceState(null, null, '?' + urlParams.toString());
    });
}

async function processAudio(audioBuffer) {
    const offlineCtx = new OfflineAudioContext(1, audioBuffer.duration * sampleRate, sampleRate);
    const offlineSource = offlineCtx.createBufferSource();
    offlineSource.buffer = audioBuffer;
    offlineSource.connect(offlineCtx.destination);
    offlineSource.start();
    offlineCtx.startRendering().then((resampled) => {
        const mono = resampled.getChannelData(0);

        if (loggedIn && speaking) {
            socket.emit('audio', { id: playfabId, isInit: localInit, packet: mono.buffer });
            localInit = false;
            //console.log("Sending Voice as " + playfabId);
        }
    });
}

async function micSetup(checkDevices) {
    if (scriptNode != null)
        scriptNode.disconnect();
    if (localMediaStreamSource != null)
        localMediaStreamSource.disconnect();
    if (localMediaStream != null) {
        localMediaStream.getTracks().forEach(function(track) {
            track.stop();
        });
    }

    scriptNode = audioCtx.createScriptProcessor(bufferSize, 1, 1);

    await navigator.mediaDevices.getUserMedia({ audio: true });

    if (checkDevices) await micInputDevice();

    navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: inputDeviceId }, echoCancellation: echoCancellation, noiseSuppression: noiseSuppression, autoGainControl: true } })
    .then(stream => {
        localMediaStream = stream;
        localMediaStreamSource = audioCtx.createMediaStreamSource(stream);
        localMediaStreamSource.connect(scriptNode);
        scriptNode.connect(audioCtx.destination);
        scriptNode.onaudioprocess = event => {
            processAudio(event.inputBuffer);
        };
    })
    .catch(error => console.log(error));
}

function volumeSetup() {
    const volumeSlider = document.getElementById('volumeRange');
    volumeSlider.addEventListener('input', function() {
        mVolume = this.value;
        localStorage.setItem('volumeValue', this.value);
    });

    if (localStorage.hasOwnProperty('volumeValue')) {
        const savedVolumeValue = localStorage.getItem('volumeValue');
        volumeSlider.value = savedVolumeValue;
    }
}

async function getInputDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const micList = [];
        let microphones = devices.filter(device => device.kind === 'audioinput');
        micList.push(microphones[0]);
        microphones = microphones.filter(device => device.deviceId !== 'default' && device.deviceId !== 'communications');
        microphones.forEach((mic) => {
            micList.push(mic);
        });
        return micList;
    } catch (error) {
        console.log('enumerateDevices error:', error);
        return [];
    }
}

async function micInputDevice() {
    const inputDevices = await getInputDevices();
    // console.log(inputDevices);
    inputDeviceId = inputDevices[0].deviceId;
    let entryLabel = 'Default';

    if (localStorage.hasOwnProperty('inputDeviceId')) {
        const savedInputDeviceId = localStorage.getItem('inputDeviceId');
        inputDevices.forEach((device) => {
            if (device.deviceId === savedInputDeviceId) {
                inputDeviceId = savedInputDeviceId;
                entryLabel = device.label;
            }
        });
    }

    if (inputDeviceId === 'default') {
        inputDeviceId = inputDevices[0].deviceId;
    }

    const dropdownCurrent = document.getElementById('dropdown-current');
    const dropdownEntries = document.getElementById('dropdown-entries');

    dropdownCurrent.innerText = entryLabel;
    dropdownCurrent.title = entryLabel;

    dropdownEntries.innerHTML = '';
    let firstDevice = true;
    inputDevices.forEach((device) => {
        let deviceTitle = device.label;
        if (firstDevice) {
            deviceTitle = 'Default';
            firstDevice = false;
        }
        const entryButton = document.createElement('button');
        entryButton.innerText = deviceTitle;
        entryButton.title = deviceTitle;

        entryButton.addEventListener('click', function() {
            dropdownCurrent.innerText = deviceTitle;
            dropdownCurrent.title = deviceTitle;
            inputDeviceId = device.deviceId;
            localStorage.setItem('inputDeviceId', device.deviceId);
            micSetup(false);
        });

        dropdownEntries.appendChild(entryButton);
    });
}

async function settingsSetup() {
    if (localStorage.hasOwnProperty('noiseCheckbox')) {
        const savedNoiseCheckbox = localStorage.getItem('noiseCheckbox');
        if (savedNoiseCheckbox === 'true')
            noiseSuppression = true;
    }

    if (localStorage.hasOwnProperty('echoCheckbox')) {
        const savedEchoCheckbox = localStorage.getItem('echoCheckbox');
        if (savedEchoCheckbox === 'true')
            echoCancellation = true;
    }

    const noiseCheckbox = document.getElementById('cbx-noise');
    const echoCheckbox = document.getElementById('cbx-echo');

    if (noiseSuppression)
        noiseCheckbox.checked = 'checked';
    if (echoCancellation)
        echoCheckbox.checked = 'checked';

    noiseCheckbox.addEventListener('change', function() {
        noiseSuppression = this.checked;
        localStorage.setItem('noiseCheckbox', this.checked);
        micSetup(false);
    });

    echoCheckbox.addEventListener('change', function() {
        echoCancellation = this.checked;
        localStorage.setItem('echoCheckbox', this.checked);
        micSetup(false);
    });
}

window.onload = () => {
    getUrlParams();
    document.getElementById('launch-button').onclick = launch;
    volumeSetup();
    settingsSetup()
        .then(function() {
            canAutoplay.audio().then(({result}) => {
                if (result === true) {
                    launch();
                }
            });
        });
};