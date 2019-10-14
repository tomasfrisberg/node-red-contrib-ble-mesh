var noble = require('@abandonware/noble');

const  State = {
    OFF: 1,

    ON_IDLE: 3,
    ON_SCANNING: 4,
    ON_WAIT_STOP_SCANNING: 5
};

function proxyClient(name, callback)
{
    this.name = name;
    this.state = State.OFF;
    this.callback = callback;

    this.MESH_PROXY_SERVICE = '1828'; //'00001828-0000-1000-8000-00805f9b34fb';
    this.MESH_PROXY_DATA_IN = '2add'; //'00002add-0000-1000-8000-00805f9b34fb';
    this.MESH_PROXY_DATA_OUT = '2ade'; //'00002ade-0000-1000-8000-00805f9b34fb';

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

proxyClient.prototype.startScanning = function (callback)
{
    this.scanCallback = callback;
    this.state = State.ON_SCANNING;

    noble.startScanning(['1828'], true);

    //noble.startScanning([0x1828], true, (errMsg) => {
    //        console.log(this.name + ": startScanning " + errMsg);
    //});
}

proxyClient.prototype.stopScanning = function ()
{
    console.log("stopScanning: State " + this.state);

    switch(this.state) {
        case State.ON_SCANNING:
            noble.stopScanning();
            this.state = State.ON_IDLE;
            break;
        default:
            console.log("stopScanning: Error unexpected state");
            break;
    } 
}

proxyClient.prototype.connect = function(peripheral)
{
    switch(this.state) {
        case State.ON_IDLE:
            this.state = State.ON_WAIT_CONNECT;
            this.peripheral = peripheral;

            this.peripheral.connect(error => {
                if(!error) {
                    console.log('Connected to', peripheral.advertisement.localName);

                    this.peripheral.on('disconnect', () => console.log('disconnected'));
                
                    // specify the services and characteristics to discover
                    const serviceUUIDs = [this.MESH_PROXY_SERVICE];
                    const characteristicUUIDs = [this.MESH_PROXY_DATA_IN, this.MESH_PROXY_DATA_OUT];
                
                    this.state = State.ON_WAIT_DISCOVER;
                    this.peripheral.discoverSomeServicesAndCharacteristics(
                        serviceUUIDs,
                        characteristicUUIDs,
                        onServicesAndCharacteristicsDiscovered.bind(this)
                    ); 
                }
                else {
                    this.state = State.ON_IDLE;
                    this.peripheral = null;

                    console.log("connect: " + error);
                }
            });
            break;
        default:
            break;
    }
}

function onServicesAndCharacteristicsDiscovered(error, services, characteristics)
{

    console.log(this.name, 'Discovered services and characteristics', error, services.length, characteristics.length);

    characteristics.forEach(ch => {
        if(ch.uuid === this.MESH_PROXY_DATA_IN) {
            this.chDataIn = ch;
        }
        if(ch.uuid === this.MESH_PROXY_DATA_OUT) {
            this.chDataOut = ch;

            this.chDataOut.on('data', onCharacteristicData.bind(this));

            this.chDataOut.subscribe(error => {
                if(error) {
                    console.log("Subscribe", error);
                }
            });
        }
    });

    /*
    const echoCharacteristic = characteristics[0];
  
    // data callback receives notifications
    echoCharacteristic.on('data', (data, isNotification) => {
      console.log('Received: "' + data + '"');
    });
    
    // subscribe to be notified whenever the peripheral update the characteristic
    echoCharacteristic.subscribe(error => {
      if (error) {
        console.error('Error subscribing to echoCharacteristic');
      } else {
        console.log('Subscribed for echoCharacteristic notifications');
      }
    });
    */
}

function onCharacteristicData(data, isNotification)
{

}


module.exports = proxyClient;