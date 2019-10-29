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
    S_ON_DISCONNECTING: "S_ON_DISCONNECTING"
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
    this.filter = filter;

    this.proxy = new ProxyClient(hexNetKey, hexAppKey, hexSrcAddr, callb);
    this.proxy.reset();
    
    // Internal state entry functions
    this.entryWaitStart = function()  {
        this.timer = setTimeout(() => {
            if(this.state == State.S_WAIT_START) {
                if(this.proxy.isOn()) {
                    this.state = this.entryOn();
                }
                else {
                    this.state = this.entryOff();
                }
            }
        }, 5000);
        return State.S_WAIT_START;
    }
    this.entryOff = function() {
        debug("entryOff");
        if(this.notify) {
            this.notify("Off");
        }
        return State.S_OFF;
    }
    this.entryOn = function() {
        debug("entryOn");
        if(this.notify) {
            this.notify("On");
        }
        return this.entryOnIdle();
    }
    this.entryOnIdle = function() {
        debug("entryOnIdle");
        this.proxy.reset();
        this.timer = setTimeout(() => {
            if(this.state === State.S_ON_IDLE) {
                this.state = this.entryOnScanning();
            }
        }, 3000);
        return State.S_ON_IDLE;
    }
    this.entryOnScanning = function() {
        debug("entryOnScanning");
        if(this.notify) {
            this.notify("Scanning");
        }
        //this.proxy.stopScanning();
        this.proxy.startScanning();
        this.wdTimer = setTimeout(() => {
            this.wdTimer = null;
            if(this.state === State.S_ON_SCANNING) {
                //this.proxy.stopScanning();
                this.state = this.entryOnIdle();
            }
        }, 5000);

        return State.S_ON_SCANNING;
    }
    this.entryOnConnecting = function() {
        debug("entryOnConnecting");
        this.wdTimer = setTimeout(() => {
            this.wdTimer = null;
            if(this.state === State.S_ON_CONNECTING) {
                //this.proxy.stopScanning();
                this.state = this.entryOnIdle();
            }
        }, 5000);
        if(this.notify) {
            this.notify("Connecting");
        }
        return State.S_ON_CONNECTING;
    }
    this.entryOnConnected = function() {
        debug("entryOnConnected");
        clearTimeout(this.wdTimer);
        this.wdTimer = null;
        //if(this.notify) {
        //    this.notify("Connected");
        //}
        return State.S_ON_CONNECTED;
    }
    this.entryOnDisconnecting = function() {
        this.proxy.disconnect();
        if(this.notify) {
            this.notify("Disconnecting");
        }
        return State.S_ON_DISCONNECTING;
    }
    this.entryClosed = function() {
        if(this.notify) {
            this.notify("Closed");
        }
        return State.S_INVALID;
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
        case State.S_ON_IDLE:
            if(status === "Off") {
                clearTimeout(this.timer);
                this.state = this.entryOff();
            }
            break;
        case State.S_ON_SCANNING:
            if(status === "Off") {
                this.state = this.entryOff();
            }
            else if(status === "ScanStart") {
                clearTimeout(this.wdTimer)
                this.wdTimer = null;
            }
            break;
        case State.S_ON_CONNECTING:
            if(status === "Connected") {
                this.state = this.entryOnConnected();
                if(this.notify) {
                    this.notify("Connected");
                }
            }
            else if(status === "Disconnected") {
                this.state = this.entryOnIdle();
            }
            else if(status === "Off") {
                this.state = this.entryOff();
            }
            break;
        case State.S_ON_CONNECTED:
            if(status === "Disconnected") {
                //if(this.notify) {
                //    this.notify("Disconnected");
                //}
                this.state = this.entryOnIdle();
            }
            else if(status === "Off") {
                //if(this.notify) {
                //    this.notify("Disconnected");
                //}
                this.state = this.entryOff();
            }
            break;
        case State.S_ON_DISCONNECTING:
            if(status === "Disconnected") {
                // if(this.notify) {
                //     this.notify("Disconnected");
                //}
                this.proxy.close();
                this.state = this.entryClosed();
            }
            break;
        default:
            //throw "Invalid state " + this.state;
            debug("Ignore status " + status + " in state " + this.state);
            break;
        }
    }

    function scanCallback(device) {
        debug("scanCallback in state ", this.state, ", device ", device.advertisement);
        switch(this.state) {
        case State.S_ON_SCANNING:
            if(this.isMatch(device)) {
                clearTimeout(this.wdTimer);
                this.wdTimer = null;
                this.proxy.stopScanning();
                this.proxy.connect(device);
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

ProxyNode.prototype.start = function(hexNetKey, hexAppKey, hexSrcAddr, filter, notify) {
    debug("start ********");
    this.notify = notify;
    this.filter = filter;
    this.proxy.setConfiguration(hexNetKey, hexAppKey, hexSrcAddr);
    /*
    if(this.proxy.isOn()) {
        this.state = this.entryOn();
    }
    else {
        this.state = this.entryOff();
    }
    */
   this.state = this.entryWaitStart();
   //this.proxy.reset();
}

ProxyNode.prototype.stop = function() {
    debug("stop ********");
    this.notify = null;
    /*
    switch(this.state) {
        case State.S_ON_SCANNING:
            this.proxy.stopScanning();
            break;
        case State.S_ON_CONNECTING:
        case State.S_ON_CONNECTED:
            this.proxy.disconnect();
            break;
    }
    */
    this.proxy.stopScanning();
    this.proxy.disconnect();
    this.state = State.S_INVALID;
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
