var ProxyClient = require('./ble-mesh-proxy-client');
var debug = require('debug')('ble-mesh-proxy-node');

const State = {
    S_INVALID: "S_INVALID",
    S_WAIT_START: "S_WAIT_START",
    S_OFF: "S_OFF",

    S_ON_IDLE: "S_ON_IDLE",

    S_ON_SCANNING: "S_ON_SCANNING",
    S_ON_CONNECTING: "S_ON_CONNECTING",

    S_ON_CONNECTED: "S_ON_CONNECTED",
};

function ProxyNode(hexNetKey, hexAppKey, hexSrcAddr, filter) {

    debug("ProxyNode Constructor");

    var callb = {
        "statusCallback": statusCallback.bind(this),
        "scanCallback": scanCallback.bind(this),
        "dataCallback": dataCallback.bind(this)
    };

    this.state = State.S_INVALID;
    this.notify = null;

    this.hexNetKey = hexNetKey;
    this.hexAppKey = hexAppKey;
    this.hexSrcAddr = hexSrcAddr;
    this.filter = filter;

    this.proxy = new ProxyClient(hexNetKey, hexAppKey, hexSrcAddr, callb);
    this.proxy.reset();
    
    // Internal state entry functions
    this.entryWaitStart = function()  {
        if(this.notify) {
            this.notify("Off");
        }
        setTimeout(() => {
            if(this.state === State.S_WAIT_START) {
                this.exitWaitStart();
                if(this.proxy.isOn()) {
                    this.state = this.entryOn();
                }
                else {
                    this.state = this.entryOff();
                }
            }
        }, 2000);
        return State.S_WAIT_START;
    }
    this.exitWaitStart = function() {

    }
    this.entryOff = function() {
        debug("entryOff");
        if(this.notify) {
            this.notify("Off");
        }
        return State.S_OFF;
    }
    this.exitOff = function() {

    }
    this.entryOn = function() {
        debug("entryOn");
        if(this.notify) {
            this.notify("On");
        }
        return this.entryOnIdle();
    }
    this.exitOn = function() {

    }
    this.entryOnIdle = function() {
        debug("entryOnIdle");
        if(this.notify) {
            this.notify("On");
        }
        this.wdTimer = setTimeout(() => {
            if(this.state === State.S_ON_IDLE) {
                this.wdTimer = null;
                this.proxy.reset();
            }
        }, 2000);
        
        this.timer = setTimeout(() => {
            if(this.state === State.S_ON_IDLE) {
                this.timer = null;
                this.exitOnIdle();
                this.state = this.entryOnScanning();
            }
        }, 3000);
        return State.S_ON_IDLE;
    }
    this.exitOnIdle = function() {
        if(this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if(this.wdTimer) {
            clearTimeout(this.wdTimer);
            this.wdTimer = null;
        }
    }
    this.entryOnScanning = function() {
        debug("entryOnScanning");
        if(this.notify) {
            this.notify("Scanning");
        }
        this.proxy.startScanning();
        this.wdTimer = setTimeout(() => {
            if(this.state === State.S_ON_SCANNING) {
                this.wdTimer = null;
                this.exitOnScanning();
                this.state = this.entryOnIdle();
            }
        }, 5000);

        return State.S_ON_SCANNING;
    }
    this.exitOnScanning = function() {
        if(this.wdTimer) {
            clearTimeout(this.wdTimer);
            this.wdTimer = null;
        }
    }
    this.entryOnConnecting = function() {
        debug("entryOnConnecting");
        this.timer = setTimeout(() => {
            if(this.state === State.S_ON_CONNECTING) {
                this.timer = null;
                this.proxy.connect(this.device);
            }
        }, 2000);
        
        this.wdTimer = setTimeout(() => {
            if(this.state === State.S_ON_CONNECTING) {
                this.wdTimer = null;
                this.proxy.disconnect();
            }
        }, 12000);
        if(this.notify) {
            this.notify("Connecting");
        }
        return State.S_ON_CONNECTING;
    }
    this.exitOnConnecting = function() {
        if(this.wdTimer) {
            clearTimeout(this.wdTimer);
            this.wdTimer = null;
        }
        if(this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
    this.entryOnConnected = function() {
        debug("entryOnConnected");

        return State.S_ON_CONNECTED;
    }
    this.exitOnConnected = function() {

    }

    // Internal callback functions
    function statusCallback(status) {
        debug("statusCallback: status ", status, ", state ", this.state);

        switch(this.state) {
        case State.S_OFF:
            if(status === "On") {
                this.exitOff();
                this.state = this.entryOn();
            }
            break;
        case State.S_ON_IDLE:
            if(status === "Off") {
                this.exitOnIdle();
                this.state = this.entryOff();
            }
            break;
        case State.S_ON_SCANNING:
            if(status === "Off") {
                this.exitOnScanning();
                this.state = this.entryOff();
            }
            else if(status === "ScanStart") {
                clearTimeout(this.wdTimer)
                this.wdTimer = null;
            }
            break;
        case State.S_ON_CONNECTING:
            if(status === "Connected") {
                this.exitOnConnecting();
                this.state = this.entryOnConnected();
                if(this.notify) {
                    this.notify("Connected");
                }
            }
            else if(status === "Disconnected") {
                this.exitOnConnecting();
                this.state = this.entryOnIdle();
            }
            else if(status === "Off") {
                this.exitOnConnecting();
                this.state = this.entryOff();
            }
            break;
        case State.S_ON_CONNECTED:
            if(status === "Disconnected") {
                this.exitOnConnected();
                this.state = this.entryOnIdle();
            }
            else if(status === "Off") {
                this.exitOnConnected();
                this.state = this.entryOff();
            }
            break;
        default:
            debug("Ignore status " + status + " in state " + this.state);
            break;
        }
    }

    function scanCallback(device) {
        debug("scanCallback in state ", this.state, ", device ", device.advertisement);
        switch(this.state) {
        case State.S_ON_SCANNING:
            if(this.isMatch(device)) {
                this.exitOnScanning();
                this.proxy.stopScanning();
                this.device = device;
                this.state = this.entryOnConnecting();
            }
            else {
                if(this.notify) {
                    this.notify("Scanning");
                }
            }
            break;
        default:
            // Ignore
            break;
        }
    }

    function dataCallback(data) {
        debug("dataCallback in state ", this.state, ", data ", data);
        switch(this.state) {
        case State.S_ON_CONNECTED:
            if(this.notify) {
                this.notify("Data", data);
            }
            break;
        default:
            // Ignore data
            break;
        }
    }

    // Internal help functions
    this.isMatch = function(device) {
        var match = false;

        if(device) {
            if((this.filter.name === "") ||
               (device.advertisement.localName && (device.advertisement.localName.includes(this.filter.name)))) {

                if((this.filter.rssi === "") || (device.rssi >= this.filter.rssi)) {
                    console.log("RSSI: " + device.rssi + " >= " + this.filter.rssi);
                    console.log("Matching device: " + device.advertisement.localName);
                    match = true;
                }
            }
        }
        return match;
    }
}

ProxyNode.prototype.getStatus = function() {
    var status = "Off";
    switch(this.state) {
    case State.S_ON_IDLE:
        status = "On";
        break;
    case State.S_ON_SCANNING:
        status = "Scanning";
        break;
    case State.S_ON_CONNECTING:
        status = "Connecting";
        break;
    case State.S_ON_CONNECTED:
        status = "Connected";
        break;
    }
    return status;
}

ProxyNode.prototype.start = function(hexNetKey, hexAppKey, hexSrcAddr, filter, notify) {
    debug("start ********");

    this.notify = notify;
    switch(this.state) {
    case State.S_INVALID:
        this.hexNetKey = hexNetKey;
        this.hexAppKey = hexAppKey;
        this.hexSrcAddr = hexSrcAddr;
        this.filter = filter;

        this.proxy.setConfiguration(hexNetKey, hexAppKey, hexSrcAddr);
        this.state = this.entryWaitStart();
        break;  
    default:
        if((hexNetKey !== this.hexNetKey) || (hexAppKey !== this.hexAppKey) || (hexSrcAddr !== this.hexSrcAddr) ||
           (filter.name !== this.filter.name) || (filter.rssi !== this.filter.rssi)) {

            if((this.state === State.S_ON_CONNECTED) || (this.state === State.S_ON_CONNECTING)) {
                this.proxy.disconnect();
            }

            this.hexNetKey = hexNetKey;
            this.hexAppKey = hexAppKey;
            this.hexSrcAddr = hexSrcAddr;
            this.filter = filter;

            this.proxy.setConfiguration(hexNetKey, hexAppKey, hexSrcAddr);
        }
        break;
    }
}

ProxyNode.prototype.stop = function() {
    debug("stop ********");
    this.notify = null;

    //this.proxy.stopScanning();
    //this.proxy.disconnect();
    //this.state = State.S_INVALID;
}

ProxyNode.prototype.publish = function(hexAddr, hexOpCode, hexPars, hexTTL = "04") {
    debug("publish in state ", this.state);
    switch(this.state) {
    case State.S_ON_CONNECTED:
        this.proxy.publish(hexAddr, hexOpCode, hexPars, hexTTL);
        break;
    default:
        break;
    }
}

ProxyNode.prototype.subscribe = function(hexAddr) {
    debug("subscribe in state ", this.state);
    switch(this.state) {
    case State.S_ON_CONNECTED:
        this.proxy.subscribe(hexAddr);
        break;
    default:
        break;
    }

}

module.exports = ProxyNode;
