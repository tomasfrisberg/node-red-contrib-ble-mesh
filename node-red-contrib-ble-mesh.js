var ProxyNode = require('./ble-mesh-proxy-node');

var filter = {
    name: "nRF5x Mesh"
}

var callback = function(status, data = null)
{
    console.log("callback: status ", status, ", data ", data);

    switch(status) {
    case "Connected":
        //proxyNode.publish("013C", "8202", "0100"); // Set onoff, TID
        //proxyNode.publish("013C", "8202", "0000"); // Set onoff, TID
        proxyNode.subscribe("C001");
        break;
    }
}

var proxyNode = proxyNode = new ProxyNode(
    "5F5F6E6F726469635F5F73656D695F5F",
    "5F116E6F726469635F5F73656D695F5F",
    "1114",
    filter,
    callback);

