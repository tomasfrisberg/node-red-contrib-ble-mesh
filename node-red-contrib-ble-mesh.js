var proxyClient = require('./ble-mesh-proxy-client');

var scanCallback = function (device)
{
    console.log(device.advertisement.localName + " " + device.address + " " + device.rssi);

    if(device.advertisement.localName && (device.advertisement.localName.length > 0))
    //if(device.advertisement.localName.includes("u-blox Mesh #30")) {
    if(device.advertisement.localName.includes("nRF5x Mesh")) {
        client.stopScanning();

        client.connect(device);
    }
}

var timer = {};
var statusCallback = function (status, data = null) {
    switch(status) {
    case "On":
        client.startScanning(scanCallback);
        break;
    case "Off":
        break;
    case "Connected":
        console.log("Connected");
        //client.subscribe("C001");
        //client.publish("013C", "8201", ""); // Get onoff
        client.publish("013C", "8202", "0100"); // Set onoff, TID
        //timer = setTimeout(() => {
        //    client.publish("013C", "8201", ""); // Get onoff
        //}, 10000);
        break;
    case "Disconnected":
            console.log("Disconnected");
        //clearTimeout(timer);
        break;
    case "Data":
        console.log("Data: ", data);
        break;
    case "Error":
        break;
    }
}

var client = new proxyClient("myName", statusCallback);
console.log(client.name);