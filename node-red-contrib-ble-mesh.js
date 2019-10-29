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

        // Store local copies of the node configuration (as defined in the .html)
        this.address = n.address.toLowerCase();
        this.name = n.name;
        this.proxy = n.proxy;
        this.log("MeshIn: Proxy " + this.proxy);
        

        this.meshProxy = RED.nodes.getNode(this.proxy);
        this.log("MeshIn: Proxy " + this.meshProxy.name);
        this.log("MeshIn: Test " + this.meshProxy.test);

        // copy "this" object in case we need it in context of callbacks of other functions.
        var node = this;

        // Do whatever you need to do in here - declare callbacks etc
        // Note: this sample doesn't do anything much - it will only send
        // this message once at startup...
        // Look at other real nodes for some better ideas of what to do....
        this.log(this.name + " is starting using proxy " + this.meshProxy.name);
        this.status({fill:"red",shape:"dot",text:"BT Off"});

        this.log(this.name + " register listener");
        eventEmitter.addListener('Status', statusCallback.bind(this));

        // respond to inputs....
        this.on('input', function (msg) {
            node.warn("I saw a payload: "+msg.payload);
            // in this example just send it straight on... should process it here really
            node.send(msg);
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
                this.status({fill:"yellow",shape:"dot",text:"BT On"});
                break;
            case "Off":
                    this.status({fill:"red",shape:"dot",text:"BT Off"});
                    break;
            case "Scanning":
                    this.status({fill:"yellow",shape:"dot",text:"Scanning"});
                    break;
            case "Connecting":
                    this.status({fill:"yellow",shape:"dot",text:"Connecting"});
                    break;                                          
            case "Connected":
                this.status({fill:"green",shape:"dot",text:"connected"});
                this.meshProxy.subscribe(this.address);
                break;
            case "Disconnected":
                this.status({fill:"red",shape:"ring",text:"disconnected"});
                break;
            case "Data":
                this.log(this.address + " : " + data.hex_dst);
                if(this.address === data.hex_dst.toLowerCase()) {
                    this.log("Msg: " + data.hex_params);
                    var msg = {};
                    /*
                    msg.hex_seq = data.hex_seq.slice(0);
                    msg.hex_src = data.hex_src.slice(0);
                    msg.hex_dst = data.hex_dst.slice(0);
                    msg.hex_opcode = data.hex_opcode.slice(0);
                    msg.hex_company_code = data.hex_company_code.slice(0);
                    msg.hex_params = data.hex_params.slice(0);
                    */
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

        this.log("Start proxy node");
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
    
    }

    // Register the node by name. This must be called before overriding any of the
    // Node functions.
    RED.nodes.registerType("mesh-proxy",MeshProxy);

}
