var ProxyClient = require('./ble-mesh-proxy-client');
var debug = require('debug')('ble-mesh-proxy-node');

const State = {
    S_INVALID: 0,
    S_OFF: 1,

    S_ON_SCANNING: 10,
    S_ON_CONNECTING: 11,
    S_ON_CONNECTED: 12
};

function ProxyNode(hexNetKey, hexAppKey, hexSrcAddr, filter, notify) {

    debug("ProxyNode Constructor");

    this.notify = notify;
    this.filter = filter;
    this.state = State.S_OFF;

    var callb = {
        "statusCallback": statusCallback.bind(this),
        "scanCallback": scanCallback.bind(this),
        "dataCallback": dataCallback.bind(this)
    };
    this.proxy = new ProxyClient(hexNetKey, hexAppKey, hexSrcAddr, callb);

    
    // Internal state entry functions
    this.entryOff = function() {
        debug("entryOff");
        return State.S_OFF;
    }
    this.entryOn = function() {
        debug("entryOn");
        return this.entryOnScanning();
    }
    this.entryOnScanning = function() {
        debug("entryOnScanning");
        this.proxy.startScanning();
        return State.S_ON_SCANNING;
    }
    this.entryOnConnecting = function() {
        debug("entryOnConnecting");
        return State.S_ON_CONNECTING;
    }
    this.entryOnConnected = function() {
        debug("entryOnConnected");
        return State.S_ON_CONNECTED;
    }

    // Internal callback functions
    function statusCallback(status) {
        debug("statusCallback: status ", status, ", state ", this.state);

        switch(this.state) {
        case State.S_OFF:
            if(status === "On") {
                this.state = this.entryOn();
            }
            break;
        case State.S_ON_SCANNING:
            if(status === "Off") {
                this.state = this.entryOff();
            }
            break;
        case State.S_ON_CONNECTING:
            if(status === "Connected") {
                this.state = this.entryOnConnected();
                this.notify("Connected");
            }
            else if(status === "Disconnected") {
                this.state = this.entryOnScanning();
            }
            else if(status === "Off") {
                this.state = this.entryOff();
            }
            break;
        case State.S_ON_CONNECTED:
            if(status === "Disconnected") {
                this.notify("Disconnected");
                this.state = this.entryOnScanning();
            }
            else if(status === "Off") {
                this.notify("Disconnected");
                this.state = this.entryOff();
            }
            break;
        default:
            throw "Invalid state " + this.state;
            break;
        }
    }

    function scanCallback(device) {
        debug("scanCallback in state ", this.state, ", device ", device);
        switch(this.state) {
        case State.S_ON_SCANNING:
            if(this.isMatch(device)) {
                this.proxy.stopScanning();
                this.proxy.connect(device);
                this.state = this.entryOnConnecting();
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
            this.notify("Data", data);
            break;
        default:
            // Ignore data
            break;
        }
    }

    // Internal help functions
    this.isMatch = function(device) {
        var match = false;
        if(device && device.advertisement.localName && device.advertisement.localName.includes(this.filter.name)) {
            match = true;
        }
        return match;
    }
}

ProxyNode.prototype.publish = function(hexAddr, hexOpCode, hexPars) {
    debug("publish in state ", this.state);
    switch(this.state) {
    case State.S_ON_CONNECTED:
        this.proxy.publish(hexAddr, hexOpCode, hexPars);
        break;
    default:
        break;
    }
}

ProxyNode.prototype.subscribe = function(hexAddr) {
    debug("publish in state ", this.state);
    switch(this.state) {
    case State.S_ON_CONNECTED:
        this.proxy.subscribe(hexAddr);
        break;
    default:
        break;
    }

}

module.exports = ProxyNode;
