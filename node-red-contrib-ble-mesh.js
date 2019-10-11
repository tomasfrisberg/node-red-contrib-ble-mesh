var proxyClient = require('./ble-mesh-proxy-client');

var scanCallback = function (device)
{
    console.log(device.advertisement.localName + " " + device.address + " " + device.rssi);
}

var statusCallback = function (status) {
    switch(status) {
        case "On":
            client.startScanning(scanCallback);
            break;
        case "Off":
            break;
        case "Error":
            break;
    }
}

var client = new proxyClient("myName", statusCallback);

console.log(client.name);