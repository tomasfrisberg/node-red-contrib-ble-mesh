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
        this.address = n.address;
        this.name = n.name;
        this.proxy = n.proxy;

        this.meshProxy = RED.nodes.getNode(this.proxy);

        // copy "this" object in case we need it in context of callbacks of other functions.
        var node = this;

        // Do whatever you need to do in here - declare callbacks etc
        // Note: this sample doesn't do anything much - it will only send
        // this message once at startup...
        // Look at other real nodes for some better ideas of what to do....
        this.log(this.name + " is starting using proxy " + this.meshProxy.name);

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
    }

    // Register the node by name. This must be called before overriding any of the
    // Node functions.
    RED.nodes.registerType("mesh-in",MeshIn);


    function MeshProxy(n) {
        // Create a RED node
        RED.nodes.createNode(this,n);

        // Store local copies of the node configuration (as defined in the .html)
        this.connected = false;
        this.name = n.name;
        this.netkey = n.netkey;
        this.appkey = n.appkey;
        this.address = n.address;
        this.proxy = n.proxy;
        this.filter = n.filter;

        this.deviceFilter = {
            name: this.filter
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
            proxyNode = new ProxyNode(this.netkey, this.appkey, this.address, this.deviceFilter, notify.bind(this));
        }
        else {
            node.warn("Proxy node already created");
        }

        // respond to inputs....
        this.on('input', function (msg) {
            this.warn("I saw a payload: "+msg.payload);
            // in this example just send it straight on... should process it here really
            node.send(msg);
        });

        this.on("close", function() {
            // Called when the node is shutdown - eg on redeploy.
            // Allows ports to be closed, connections dropped etc.
            // eg: node.client.disconnect();
            proxyNode.close();
            proxyNode = null;
            this.log(this.name + " is closing");
        });

        function notify(status, data) {
            this.log("notify(" + this.name + "): Status " + status);

            switch(status) {
            case "Connected":
                this.connected = true;
                break;
            case "Disconnected":
                this.connected = false;
                break;
            }
        }
    }

    // Register the node by name. This must be called before overriding any of the
    // Node functions.
    RED.nodes.registerType("mesh-proxy",MeshProxy);

}
