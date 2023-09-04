const voiceUsers = new Map();
var ctx = null;
var initDelay = 200;
var isAlive = false;
var masterGain = null;
var dynamicsCompressor = null;
var listener = null;
var mVolume = 1.0;
var currentMVolume = 1.0;
var mutedPlayers = [];
var voiceSettings = { panningModel: "HRTF", distanceModel: "linear", refDistance: 0.0, maxDistance: 1800, rolloffFactor: 1, coneInnerAngle: 360, coneOuterAngle: 0, coneOuterGain: 0 };
//var voiceSettings = { panningModel: "HRTF", distanceModel: "exponential", refDistance: 350.0, maxDistance: 18000, rolloffFactor: 1.5, coneInnerAngle: 360, coneOuterAngle: 0, coneOuterGain: 0 };

const principalAxesToOrientation = (y = 0, p = 0, r = 0) => {
    const { yaw = 0, pitch = 0, roll = 0 } = typeof y === 'object'
        ? y
        : { yaw: y, pitch: p, roll: r };
    const forward = {};
    const up = {};

    const yawRad = yaw * (Math.PI / 180);
    forward.x = Math.sin(yawRad);
    forward.z = Math.cos(yawRad + Math.PI);

    const pitchRad = pitch * (Math.PI / 180);
    forward.y = Math.sin(pitchRad);
    up.y = Math.cos(pitchRad);

    const rollRad = roll * (Math.PI / 180);
    up.x = Math.sin(rollRad);
    up.z = Math.sin(rollRad);

    return { forward, up };
};

const calculateListenerOrientation = principalAxesToOrientation;
const calculatePannerOrientation = (yaw, pitch) =>
    principalAxesToOrientation(yaw, pitch).forward;

function receiverSetup() {
    ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: sampleRate });
    masterGain = ctx.createGain();
    dynamicsCompressor = ctx.createDynamicsCompressor();
    listener = ctx.listener;

    setMVolume(0.0);
    masterGain.connect(dynamicsCompressor);
    dynamicsCompressor.connect(ctx.destination);

    if (localStorage.hasOwnProperty('volumeValue')) {
        mVolume = localStorage.getItem('volumeValue');
    }
}

async function receiverSockets() {
    socket.on('voice-data', async (data) => {
        if (!loggedIn) return;

        if (voiceUsers.has(data.id)) {
            voiceUsers.get(data.id).addPacket(data.packet, data.isInit);
        }
        else {
            let alreadyMuted = false;
            if (mutedPlayers.includes(data.id)) {
                alreadyMuted = true;
            }
    
            const user = new VoiceUser(data.id, ctx, sampleRate, initDelay, masterGain, alreadyMuted, voiceSettings);
            voiceUsers.set(data.id, user);
            user.addPacket(data.packet, data.isInit);
        }
    });

    socket.on('list', async (playerList) => {
        if (!loggedIn) return;

        let didSelfUpdate = false;

        playerList.forEach(player => {
            if (player.id == playfabId && player.status == 'alive') {
                selfPosUpdate(player.x, player.y, player.z, player.yaw);
                didSelfUpdate = true;
            }
            else if (player.status == 'alive') {
                if (voiceUsers.has(player.id)) {
                    voiceUsers.get(player.id).setPos(player.x, player.y, player.z);
                }
                else {
                    let alreadyMuted = false;
                    if (mutedPlayers.includes(player.id)) {
                        alreadyMuted = true;
                    }

                    const user = new VoiceUser(player.id, ctx, sampleRate, initDelay, masterGain, alreadyMuted, voiceSettings);
                    voiceUsers.set(player.id, user);
                    user.setPos(player.x, player.y, player.z);
                }
            }
        });

        if (!didSelfUpdate)
            selfDeadUpdate();
    });

    socket.on('local-mute', async (data) => {
        if (!loggedIn) return;

        if (data.mute == 'true')
            muteAPlayer(data.target);
        else if (data.mute == 'false')
            unmuteAPlayer(data.target);
    });
}

function selfPosUpdate(x, y, z, yaw) {
    if (!isAlive) {
        isAlive = true;
    }

    if (currentMVolume != mVolume) {
        setMVolume(mVolume);
    }

    listener.setPosition(x, z, y);
    let o = calculateListenerOrientation(yaw + 90, 0, 0);
    listener.setOrientation(o.forward.x, o.forward.y, o.forward.z, o.up.x, o.up.y, o.up.z);
}

function selfDeadUpdate() {
    if (isAlive) {
        isAlive = false;
        setTimeout(() => {
            setMVolume(0.0);
        }, 4500);
    }
}

function setMVolume(vol) {
    if (isFinite(vol))
    {
        masterGain.gain.value = vol;
        currentMVolume = vol;
    }
}

function updateMuteListQuery() {
    let newMuteListQuery = "";

    mutedPlayers.forEach( function(playfab) {
        newMuteListQuery += playfab;
        newMuteListQuery += ',';
    });

    newMuteListQuery = newMuteListQuery.substring(0, newMuteListQuery.length - 1);
    const urlParams = new URLSearchParams(window.location.search);
    urlParams.set('mutelist', newMuteListQuery);
    const url = new URL(window.location.href);
    url.search = urlParams.toString();
    window.history.replaceState(null, null, '?' + urlParams.toString());
}

function muteAPlayer(p) {
    let playfabId = p.trim();
    if (mutedPlayers.includes(playfabId)) return;

    mutedPlayers.push(playfabId);

    if (voiceUsers.has(playfabId)) {
        voiceUsers.get(playfabId).setFinalGain(0.0);
    }

    updateMuteListQuery();
}

function unmuteAPlayer(p) {
    let playfabId = p.trim();
    if (!mutedPlayers.includes(playfabId)) return;

    mutedPlayers = mutedPlayers.filter(function(e) { return e !== playfabId });

    if (voiceUsers.has(playfabId)) {
        voiceUsers.get(playfabId).setFinalGain(1.0);
    }

    updateMuteListQuery();
}