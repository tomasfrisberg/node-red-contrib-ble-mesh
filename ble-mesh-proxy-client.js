var noble = require('@abandonware/noble');

const  State = {
    OFF: 1,
    ON_IDLE: 2,
    ON_SCANNING: 3,
    ON_WAIT_STOP_SCANNING: 4
};

function proxyClient(name, callback)
{
    this.name = name;
    this.state = State.OFF;
    this.callback = callback;

    noble.on('stateChange', (state) => {
        console.log(this.name + ": State " + state);
        switch(state) {
            case "poweredOn":
                this.state = State.ON_IDLE;
                this.callback("On");
                break;
            case "poweredOff":
                this.state = State.OFF;
                this.callback("Off");
                break;
            }
    });

    noble.on('scanStart',  () => {
        console.log(this.name + ": ScanStart");
    });

    noble.on('scanStop', () => {
        console.log(this.name + ": ScanStop");
    });

    noble.on('discover', (peripheral) => {
        //console.log(this.name + ": Discover " + peripheral.address + " " + peripheral.advertisement.localName);
    
        if(this.scanCallback) {
            this.scanCallback(peripheral);
        }
    });

    noble.on('warning', (msg) => {
        console.log(this.name + ": Warning " + msg);
    });

    /*
    peripheral.once('connect', callback);
    peripheral.once('disconnect', callback);
    peripheral.once('rssiUpdate', callback(rssi));
    peripheral.once('servicesDiscover', callback(services));
    service.once('includedServicesDiscover', callback(includedServiceUuids));
    service.once('characteristicsDiscover', callback(characteristics));
    characteristic.on('data', callback(data, isNotification));
    //characteristic.once('read', callback(data, isNotification)); // legacy
    characteristic.once('write', withoutResponse, callback());
    characteristic.once('broadcast', callback(state));
    characteristic.once('notify', callback(state));
    characteristic.once('descriptorsDiscover', callback(descriptors));
    descriptor.once('valueRead', data);
    descriptor.once('valueWrite');
    */
}

proxyClient.prototype.startScanning = function (callback) {
    this.scanCallback = callback;

    noble.startScanning(['1828'], true);

    //noble.startScanning([0x1828], true, (errMsg) => {
    //        console.log(this.name + ": startScanning " + errMsg);
    //});
}

module.exports = proxyClient;