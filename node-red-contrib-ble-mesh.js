/**
 * Copyright JS Foundation and other contributors, http://js.foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

// If you use this as a template, update the copyright with your own name.

// Sample Node-RED node file

var events = require('events');
var eventEmitter = new events.EventEmitter();

var utils = require("./utils");

var ProxyNode = require("./ble-mesh-proxy-node");
var proxyNode = null;

module.exports = function(RED) {
    "use strict";
    // require any external libraries we may need....
    //var foo = require("foo-library");

    // The main node definition - most things happen in here
    function MeshIn(n) {
        // Create a RED node
        RED.nodes.createNode(this,n);

        this.status({fill:"red",shape:"dot",text:"Off"});

        // Store local copies of the node configuration (as defined in the .html)
        this.address = n.address.toLowerCase();
        this.name = n.name;
        this.proxy = n.proxy;
        

        this.meshProxy = RED.nodes.getNode(this.proxy);

        // copy "this" object in case we need it in context of callbacks of other functions.
        var node = this;

        // Do whatever you need to do in here - declare callbacks etc
        // Note: this sample doesn't do anything much - it will only send
        // this message once at startup...
        // Look at other real nodes for some better ideas of what to do....
        eventEmitter.addListener('Status', statusCallback.bind(this));

        var status = this.meshProxy.getStatus();
        var name = this.meshProxy.getProxyServerName();
        (statusCallback.bind(this))(status, name);

        // respond to inputs....
        this.on('input', function (msg) {
            node.warn("I saw a payload: "+msg.payload);
            // in this example just send it straight on... should process it here really
            this.send(msg);
        });

        this.on("close", function() {
            // Called when the node is shutdown - eg on redeploy.
            // Allows ports to be closed, connections dropped etc.
            // eg: node.client.disconnect();
            this.log(this.name + " is closing");
        });

        function statusCallback(status, data = null) {
            switch(status) {
            case "On":
                this.status({fill:"yellow",shape:"dot",text:"BLE On"});
                break;
            case "Off":
                    this.status({fill:"red",shape:"dot",text:"BLE Off"});
                    break;
            case "Scanning":
                    this.status({fill:"yellow",shape:"dot",text:"Scanning"});
                    break;
            case "Connecting":
                    this.status({fill:"yellow",shape:"dot",text:"Connecting"});
                    break;                                          
            case "Connected":
                var txt = data || "Connected";
                this.status({fill:"green",shape:"dot",text:txt});
                this.meshProxy.subscribe(this.address);
                break;
            case "Disconnected":
                this.status({fill:"red",shape:"ring",text:"disconnected"});
                break;
            case "Data":
                if(this.address === data.hex_dst.toLowerCase()) {
                    var msg = {};
                    msg.ttl = utils.hexToBytes(data.hex_ttl);
                    msg.seq = utils.hexToBytes(data.hex_seq);
                    msg.src = utils.hexToBytes(data.hex_src);
                    msg.dst = utils.hexToBytes(data.hex_dst);
                    msg.opcode = utils.hexToBytes(data.hex_opcode);
                    msg.company_code = utils.hexToBytes(data.hex_company_code);
                    msg.params = utils.hexToBytes(data.hex_params);

                    this.send(msg);
                }
                break;
            }
        }
    }

    // Register the node by name. This must be called before overriding any of the
    // Node functions.
    RED.nodes.registerType("mesh-in",MeshIn);

    function MeshOut(n) {
        // Create a RED node
        RED.nodes.createNode(this,n);

        this.status({fill:"red",shape:"dot",text:"Off"});

        // Store local copies of the node configuration (as defined in the .html)
        this.address = n.address.toLowerCase();
        this.opcode = n.opcode;
        this.params = n.params;
        this.ttl = n.ttl;
        this.name = n.name;
        this.proxy = n.proxy;
        

        this.meshProxy = RED.nodes.getNode(this.proxy);

        // copy "this" object in case we need it in context of callbacks of other functions.
        var node = this;

        // Do whatever you need to do in here - declare callbacks etc
        // Note: this sample doesn't do anything much - it will only send
        // this message once at startup...
        // Look at other real nodes for some better ideas of what to do....
        eventEmitter.addListener('Status', statusCallback.bind(this));

        var status = this.meshProxy.getStatus();
        var name = this.meshProxy.getProxyServerName();
        (statusCallback.bind(this))(status, name);

        // respond to inputs....
        this.on('input', function (msg) {
            var hexAddr = this.address;
            var hexOpCode = this.opcode;
            var hexPars = this.params;
            var hexTTL = this.ttl;
            if(msg.address) {
                if(typeof msg.address === "string") {
                    hexAddr = msg.address;
                }
                else {
                    hexAddr = utils.bytesToHex(msg.address);
                }
            }
            if(msg.opcode) {
                if(typeof msg.opcode === "string") {
                    hexOpCode = msg.opcode;
                }
                else {
                    hexOpCode = utils.bytesToHex(msg.opcode);
                }
            }
            if(msg.payload) {
                if(typeof msg.payload === "string") {
                    hexPars = msg.payload;
                }
                else {
                    hexPars = utils.bytesToHex(msg.payload);
                }
            }
            else if(msg.params) {
                if(typeof msg.params === "string") {
                    hexPars = msg.params;
                }
                else {
                    hexPars = utils.bytesToHex(msg.params);
                }
            }
            if(msg.ttl && (typeof msg.ttl === "number")) {
                hexTTL = utils.toHex(msg.ttl);
            }
            if(hexTTL.length % 2 !== 0) {
                hexTTL = "0" + hexTTL;
            }
            this.meshProxy.publish(hexAddr, hexOpCode, hexPars, hexTTL);
        });

        this.on("close", function() {
            // Called when the node is shutdown - eg on redeploy.
            // Allows ports to be closed, connections dropped etc.
            // eg: node.client.disconnect();
            this.log(this.name + " is closing");
        });

        function statusCallback(status, data = null) {
            switch(status) {
            case "On":
                this.status({fill:"yellow",shape:"dot",text:"BLE On"});
                break;
            case "Off":
                    this.status({fill:"red",shape:"dot",text:"BLE Off"});
                    break;
            case "Scanning":
                    this.status({fill:"yellow",shape:"dot",text:"Scanning"});
                    break;
            case "Connecting":
                    this.status({fill:"yellow",shape:"dot",text:"Connecting"});
                    break;                                          
            case "Connected":
                var txt = data || "Connected";
                this.status({fill:"green",shape:"dot",text:txt});
                break;
            case "Disconnected":
                this.status({fill:"red",shape:"ring",text:"disconnected"});
                break;
            case "Data":
                if((this.address === data.hex_src.toLowerCase()) &&
                   (this.meshProxy.address === data.hex_dst.toLowerCase())) {
                    var msg = {};
                    msg.ttl = utils.hexToBytes(data.hex_ttl);
                    msg.seq = utils.hexToBytes(data.hex_seq);
                    msg.src = utils.hexToBytes(data.hex_src);
                    msg.dst = utils.hexToBytes(data.hex_dst);
                    msg.opcode = utils.hexToBytes(data.hex_opcode);
                    msg.company_code = utils.hexToBytes(data.hex_company_code);
                    msg.params = utils.hexToBytes(data.hex_params);

                    this.send(msg);
                }
                break;
            }
        }
    }

    // Register the node by name. This must be called before overriding any of the
    // Node functions.
    RED.nodes.registerType("mesh-out",MeshOut);


    function MeshProxy(n) {
        // Create a RED node
        RED.nodes.createNode(this,n);

        // Store local copies of the node configuration (as defined in the .html)
        this.name = n.name;
        this.netkey = n.netkey;
        this.appkey = n.appkey;
        this.address = n.address.toLowerCase();
        this.proxy = n.proxy;
        this.filter = n.filter;
        this.rssi = n.rssi;

        this.valRssi = -1000;
        if(this.rssi) {
            this.valRssi = parseInt(this.rssi, 10);
        }

        this.deviceFilter = {
            name: this.filter,
            rssi: this.valRssi
        };

        // copy "this" object in case we need it in context of callbacks of other functions.
        var node = this;

        // Do whatever you need to do in here - declare callbacks etc
        // Note: this sample doesn't do anything much - it will only send
        // this message once at startup...
        // Look at other real nodes for some better ideas of what to do....
        if(proxyNode === null) {
            this.log("Mesh Proxy Open:");
            this.log("Net key: " + this.netkey);
            this.log("App key: " + this.appkey);
            this.log("Local Addr: " + this.address);
            this.log("Device filter: " + this.deviceFilter.name);
            this.log("Minimum RSSI " + this.rssi);
            proxyNode = new ProxyNode(this.netkey, this.appkey, this.address, this.deviceFilter);
        }

        proxyNode.start(this.netkey, this.appkey, this.address, this.deviceFilter, notify.bind(this));

        // respond to inputs....
        this.on('input', function (msg) {
            this.warn("I saw a payload: "+msg.payload);
            // in this example just send it straight on... should process it here really
            node.send(msg);
        });

        this.on("open", function() {
            this.log(this.name + " is opening");
        });

        this.on("close", function() {
            // Called when the node is shutdown - eg on redeploy.
            // Allows ports to be closed, connections dropped etc.
            // eg: node.client.disconnect();
            this.log(this.name + " is closing");
            proxyNode.stop();
            
            eventEmitter.emit("Disconnected");
            eventEmitter.removeAllListeners();
        });

        function notify(status, data) {
            this.log("notify(" + this.name + "): Status " + status);
            eventEmitter.emit("Status", status, data);
        }

        this.subscribe = function(addr) {
            this.log("subscribe: " + addr);
            proxyNode.subscribe(addr);
        }

        this.publish = function(hexAddr, hexOpCode, hexPars, hexTTL) {
            this.log("Publish: Addr " + hexAddr + ", Op Code " + hexOpCode + ", Pars " + hexPars + ", TTL " + hexTTL);
            proxyNode.publish(hexAddr, hexOpCode, hexPars, hexTTL);
        }
    
        this.getStatus = function() {
            return proxyNode.getStatus();
        }
        this.getProxyServerName = function() {
            return proxyNode.getProxyServerName();
        }
    }

    // Register the node by name. This must be called before overriding any of the
    // Node functions.
    RED.nodes.registerType("mesh-proxy",MeshProxy);

}
