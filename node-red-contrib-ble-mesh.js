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

var statusCallback = function (status) {
    switch(status) {
    case "On":
        client.startScanning(scanCallback);
        break;
    case "Off":
        break;
    case "Connected":
        client.subscribe("55667788");
        break;
    case "Disconnected":
        break;
    case "Error":
        break;
    }
}

var client = new proxyClient("myName", statusCallback);
console.log(client.name);