class VoiceUser {
    constructor(id, ctx, rate, initDelay, mGain, alreadyMuted, voipSettings) {
        this.id = id;
        this.rate = rate;
        this.initDelay = initDelay;
        this.queue = [];
        this.waiting = false;
        this.ctx = ctx;
        this.finalGain = ctx.createGain();
        this.normalizerGain = ctx.createGain();
        this.initialized = false;
        //console.log(voipSettings);
        this.panner = new PannerNode(ctx, voipSettings);
        this.delayArray = new Float32Array(Math.round(this.rate * (this.initDelay / 1000.0)));
        this.hasInitBefore = false;
        this.feeder = new AudioFeeder({ audioContext: ctx, output: this.normalizerGain });

        this.normalizerGain.connect(this.panner);
        this.panner.connect(this.finalGain);
        this.finalGain.connect(mGain);

        this.feeder.onbufferlow = () => { this.handleBufferLow() };
        this.feeder.onstarved = () => { /*console.log('starving'); this.feeder.bufferData([new Float32Array(5000)]);*/ };
        this.setupFeeder();
        this.averages = [];

        if (alreadyMuted) {
            this.finalGain.gain.value = 0.0;
        }
        this.speakingTime = 0;
        this.platformName = "";
        this.pannerPos = {x: 0.0, y: 0.0, z: 0.0};
    }

    async setupFeeder() {
        var startFn = () => {
            this.feeder.start();
            // this.bufferDelayArray();
            while (this.queue.length > 0) {
                const p = this.queue.shift();
                this.bufferPacket(p.packet, p.init);
            }
            this.initialized = true;
        };
        if (!this.initialized) {
            this.feeder.init(1, this.rate);
            this.feeder.waitUntilReady(startFn);
        } else startFn();
    }

    async handleBufferLow() {
        // while (this.feeder.durationBuffered < this.feeder.bufferThreshold) {
        //     this.feeder.bufferData([new Float32Array(2000)]);
        // }
    }

    async addPacket(packet, init) {
        if (!this.initialized) {
            this.queue.push({ init: init, packet: packet });
            return;
        }

        this.bufferPacket(packet, init);
    }

    bufferDelayArray() {
        this.feeder.bufferData([this.delayArray]);
    }

    bufferPacket(packet, init) {
        if (init) {
            this.feeder.flush();
            // if (this.hasInitBefore) {
            //     this.gainNode.gain.value = 0.0;
            //     setTimeout(() => {
            //         this.gainNode.gain.value = 1.0;
            //     }, 450);
            // }
            
            this.bufferDelayArray();
            this.hasInitBefore = true;
        }

        const f32 = new Float32Array(packet);
        this.normalize(f32);
        this.feeder.bufferData([f32]);
        this.speakingTime = Date.now() + 300;
    }

    normalize(packet) {
        var sliceLen = Math.floor(this.rate * 0.05);
        var averages = [];
        var sum = 0.0;
        for (var i = 0; i < packet.length; i++) {
            sum += packet[i] ** 2;
            if (i % sliceLen === 0) {
                sum = Math.sqrt(sum / sliceLen);
                averages.push(sum);
                sum = 0;
            }
        }
        // Ascending sort of the averages array
        averages.sort(function (a, b) { return a - b; });
        // Take the average at the 95th percentile
        var a = averages[Math.floor(averages.length * 0.95)];
        //console.log("Average Packet Val: " + a);
        //if (a < 0.0001) return;
        this.averages.push(a);
        if (this.averages.length >= 150) {
            this.averages.shift();
        }
        else if (this.averages.length < 6) {
            return;
        }

        let total = 0.0;
        for (let i = 0; i < this.averages.length; i++) {
            total += this.averages[i];
        }
        const avg = total / this.averages.length;

        var gain = 1.0 / avg;
        // Perform some clamping
        // gain = Math.max(gain, 0.02);
        // gain = Math.min(gain, 100.0);

        // ReplayGain uses pink noise for this one one but we just take
        // some arbitrary value... we're no standard
        // Important is only that we don't output on levels
        // too different from other websites
        gain = gain / 10.0;
        gain = Math.min(gain, 5.0);
        if (isFinite(gain)) {
            //console.log(`Normalizing to: ${gain}`);
            this.normalizerGain.gain.value = gain;
        }
    }

    getFinalGain() {
        return this.finalGain;
    }

    setFinalGain(newVal) {
        if (isFinite(newVal)) {
            this.finalGain.gain.value = newVal;
        }
    }

    setPos(x, y, z) {
        if (this.panner.positionX !== x || this.panner.positionY !== z || this.panner.positionZ !== y)
            this.panner.setPosition(x, z, y);
    }

    getSpeakingTime() {
        return this.speakingTime;
    }

    setPName(pName) {
        this.platformName = pName;
    }

    getPName() {
        return this.platformName;
    }

    getPannerPos() {
        return this.pannerPos;
    }
}