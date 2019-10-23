var ProxyNode = require('./ble-mesh-proxy-node');

var hexLocalAddr = "1115";

var filter = {
    name: "nRF5x Mesh"
}

var on = 0;
var callback = function(status, data = null)
{
    console.log("callback: status ", status, ", data ", data);

    switch(status) {
    case "Connected":
        proxyNode.publish("013C", "8202", "0100"); // Set onoff, TID
        //proxyNode.publish("013C", "8202", "0000"); // Set onoff, TID
        proxyNode.subscribe("C001");
        break;
    case "Data":
        if(data.hex_dst !== hexLocalAddr) {
            on = on + 1;
            if(on % 2 === 0) {
                proxyNode.publish("013C", "8202", "0000");
            }
            else {
                proxyNode.publish("013C", "8202", "0100");
            }
        }
        else {
            console.log("Data to self");
        }
        break;
    }
}

var proxyNode = proxyNode = new ProxyNode(
    "5F5F6E6F726469635F5F73656D695F5F",
    "5F116E6F726469635F5F73656D695F5F",
    hexLocalAddr,
    filter,
    callback);

