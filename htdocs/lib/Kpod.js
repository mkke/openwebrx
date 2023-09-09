/*
 Elecraft K-Pod HID driver
 (C) 2023 by Michael Stuermer DG5SEK <ms@mallorn.de>
*/

var kpod;

function initKpod() {
    kpod = new Kpod($('#openwebrx-panel-receiver').demodulatorPanel())
    if (kpod.isAvailable()) {
        $('#panel-kpod-button').css("display", "");
    }
}

function Kpod(demodulatorPanel, pollInterval) {
    this.demodulatorPanel = demodulatorPanel;
    this.devices = {};
    // IPC sent is limited to 20 IPC/s => 50ms.
    this.pollInterval = (pollInterval !== undefined) ? pollInterval : 50;

    if (navigator.hid === undefined) {
        this.available = false;
    } else {
        this.available = true;

        navigator.hid.addEventListener("connect", device => this.onConnect(device))
        navigator.hid.addEventListener("disconnect", device => this.onDisconnect(device))

        let kpod = this
        navigator.hid.getDevices().then((devices) => {
            if (devices.length > 0) {
                devices.forEach((device) => {
                    kpod.onConnect(device)
                })
            }
        })
    }
}

Kpod.prototype.isAvailable = function() {
    return this.available;
}

Kpod.prototype.isConnected = function() {
    return this.devices.length > 0;
}

Kpod.prototype.onConnect = function(device) {
    console.log(`kpod: device connected: ${device.productName}`);

    let deviceInfo =  this.devices[device];
    if (deviceInfo !== undefined && deviceInfo.pollTimer !== undefined) {
        clearInterval(this.devices[device].pollTimer);
    }

    kpod.devices[device] = {};
    if (!device.opened) {
        device.addEventListener("inputreport", inputreport => this.onInputReport(inputreport));
        device.open().then(() => this.startPoll(device));
    } else {
        this.startPoll(device)
    }
}

Kpod.prototype.startPoll = function(device) {
    this.getUpdate(device);
    const pollTimer = setInterval(() => {
        if (device.opened) {
            this.getUpdate(device);
        } else {
            clearInterval(this.devices[device].pollTimer);
            delete this.devices[device];
        }
    }, this.pollInterval)
    this.devices[device].pollTimer = pollTimer;
}

Kpod.prototype.onDisconnect = function(device) {
    console.log(`kpod: device disconnected: ${device.productName}`);
    device.close();
}

Kpod.prototype.onInputReport = function(inputreport) {
    const { data, device, reportId } = inputreport;
    if (data.getUint8(0) === 0x75) {
        let ticks = (data.getUint8(2) * 256 + data.getUint8(1));
        if (ticks & 0x8000) {
            ticks = -65536 + ticks;
        }
        const button = data.getUint8(3) & 0x0f;
        const hold = !!(data.getUint8(3) & 0x10);
        const ri = (data.getUint8(3) & 0x60) >> 5;
        const rocker = ri === 0x00 ? "center" : ri === 0x01 ? "right" : ri === 0x02 ? "left" : "error";

        // console.log(`kpod: input report: ticks=${ticks} button=${button} hold=${hold} rocker=${rocker}`);

        if (ticks != 0) {
            const d = this.demodulatorPanel.getDemodulator();
            if (d != undefined) {
                const scale = rocker === "left" ? 500 : rocker === "center" ? 50 : 5;
                d.set_offset_frequency(d.get_offset_frequency() + (scale * ticks));
            }
        }
        if (button > 0 && !hold) {
            var listbox = $("#openwebrx-sdr-profiles-listbox")[0];
            if (button <= listbox.options.length) {
                listbox.value = listbox.options[button-1].value
                sdr_profile_changed();
            }
        }
    }
}

Kpod.prototype.requestDevice = async function() {
    const devices = await navigator.hid.requestDevice({filters: [{
        vendorId: 0x04d8, productId: 0xf12d,
    }]});
    if (devices != null) {
        devices.forEach((device) => {
            this.devices[device] = {}
            this.onConnect(device)
        })
    }
}

Kpod.prototype.getUpdate = function(device) {
    const getUpdateData = [0x75, 0, 0, 0, 0, 0, 0, 0];
    device.sendReport(0x00, new Uint8Array(getUpdateData)).
        catch(() => `kpod: failed to send cmd to ${device.productName}`);
}
