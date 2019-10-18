var noble = require('@abandonware/noble');
var utils = require('./utils.js');
//var CryptoJS = require('./crypto-js-ext/cryptojs-aes.min.js');
var crypto = require('./crypto.js');

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

    this.iv_index = "00000000"; //"12345677";
    this.netkey = "5F5F6E6F726469635F5F73656D695F5F";
    this.appkey = "5F116E6F726469635F5F73656D695F5F";
    this.encryption_key = "";
    this.privacy_key = "";
    this.network_id = "";

    this.sar = 0;
    this.msg_type = 0;
    // network PDU fields
    this.ivi = 0;
    this.nid = "00";
    this.ctl = 0;
    this.ttl = "03";
    this.seq = 460810; // 0x0x07080a 
    this.src = "1234";
    this.dst = "C105";
    this.seg = 0;
    this.akf = 1;
    this.aid = "00";
    this.opcode;
    this.opparams;
    this.access_payload;
    this.transmic;
    this.netmic;

    this.mtu = 33;

    crypto.init();

    this.N = utils.normaliseHex(this.netkey);
    this.P = "00";
    this.A = utils.normaliseHex(this.appkey);
    this.k2_material = crypto.k2(this.netkey, "00");
    this.hex_encryption_key = this.k2_material.encryption_key;
    this.hex_privacy_key = this.k2_material.privacy_key;
    this.hex_nid = this.k2_material.NID;
    this.network_id = crypto.k3(this.netkey);
    this.aid = crypto.k4(this.appkey);
    this.I = utils.normaliseHex(this.iv_index);
    this.ivi = utils.leastSignificantBit(parseInt(this.I, 16));

    console.log("hex_encryption_key ", this.hex_encryption_key);
    console.log("hex_privacy_key ", this.hex_privacy_key);

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
            //this.chDataOut.on('read', onCharacteristicData.bind(this));

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

function onCharacteristicData(octets, isNotification)
{
    // length validation
    if (octets.length < 1) {
      console.log("Error: No data received");
      return;
    }
  
    // -----------------------------------------------------
    // 1. Extract proxy PDU fields : SAR, msgtype, data
    // -----------------------------------------------------
    sar_msgtype = octets.subarray(0, 1)[0];
    console.log("sar_msgtype="+sar_msgtype);
    sar = (sar_msgtype & 0xC0) >> 6;
    if (sar < 0 || sar > 3) {
      console.log("SAR contains invalid value. 0-3 allowed. Ref Table 6.2");
      return;
    }
    
    msgtype = sar_msgtype & 0x3F;
    if (msgtype < 0 || msgtype > 3) {
      console.log("Message Type contains invalid value. 0x00-0x03 allowed. Ref Table 6.3");
      return;
    }
  
    // See table 3.7 for min length of network PDU and 6.1 for proxy PDU length
    if (octets.length < 15) {
      console.log("PDU is too short (min 15 bytes) - " + octets.length+" bytes received");
      return;
    }
  
    network_pdu = null;
    network_pdu = octets.subarray(1, octets.length);
  
    console.log("Proxy PDU: SAR=" + utils.intToHex(sar) + " MSGTYPE=" + utils.intToHex(msgtype) + " NETWORK PDU=" + utils.u8AToHexString(network_pdu));
  
    switch(msgtype) {
    case 0x00:
        // Network PDU
        console.log("Network PDU");
        this.parseNetworkPdu(network_pdu);
        break;
    case 0x01:
        // Mesh beacon
        console.log("Mesh Beacon");
        this.parseMeshBeacon(network_pdu);
        break;
    case 0x02:
        // Proxy configuration
        console.log("Proxy Configuration");
        this.parseProxyConfiguration(network_pdu);
        break;
    case 0x03:
        // Provisioning PDU
        console.log("Provisioning PDU not supported");
        break;
    default:
        // RFU
        console.log("RFU not supported");
        break;
    }
}

proxyClient.prototype.parseMeshBeacon = function (network_pdu) {
    if(network_pdu[0] == 0x01) {

        var nId = utils.u8AToHexString(network_pdu.subarray(2, 10));

        //TODO: verify authentication value

        console.log("Secure network beacon");

        if(nId === this.network_id) {
            console.log("Matching network id");

            this.iv_index = utils.u8AToHexString(network_pdu.subarray(10, 14));
            this.I = utils.normaliseHex(this.iv_index);
            this.ivi = utils.leastSignificantBit(parseInt(this.I, 16));

            this.setFilterType(0x00);
        }
    }
}

proxyClient.prototype.networkNonceMicSize = function(msgType, ctl, ttl, hex_seq, hex_src, hex_iv_index) {
    var result = {};

    switch(msgType) {
        case 0:
            // Nework nonce
            ctl_int = parseInt(ctl, 16);
            ttl_int = parseInt(ttl, 16);
            ctl_ttl = (ctl_int << 7) | ttl_int;
            hex_npdu2 = utils.intToHex(ctl_ttl);
            result.nonce = "00" + hex_npdu2 + hex_seq + hex_src + "0000" + hex_iv_index;
            result.mic_size = 4;
            break;
        case 2:
            // Proxy nonce
            result.hex_nonce = "0300" + hex_seq + hex_src + "0000" + hex_iv_index;
            result.mic_size = 8;
            break;
        default:
            console.log("ERROR nonce not implemented");
            break;
    }

    return result;
}

proxyClient.prototype.parseProxyConfiguration = function(network_pdu) {

    var hex_deobfuscate = this.deobfuscateNetworkPdu(network_pdu);

    var hex_decrypted = this.decryptAndVerifyNetworkPdu(2, hex_deobfuscate);

    if(hex_decrypted.substring(0, 4) === "0000") {
        // Destination address must be non-valid
        var hex_op_code = hex_decrypted.substring(4, 6);
        switch(hex_op_code) {
            case "03":
                var hex_filter_type = hex_decrypted.substring(6, 8);
                var hex_list_size = hex_decrypted.substring(8, 12);

                console.log("hex_op_code ", hex_op_code, " hex_filter_type ", hex_filter_type, " hex_list_size ", hex_list_size);
                break;
            default:
                console.log("Unknown op code ", hex_op_code);
                break;
        }

    }
    else {
        console.log("Non-valid destination address ", hex_decrypted.substring(0, 4));
    }
}

proxyClient.prototype.deobfuscateNetworkPdu = function (network_pdu) {
    // demarshall obfuscated network pdu
    pdu_ivi = network_pdu.subarray(0, 1)[0] & 0x80;
    pdu_nid = network_pdu.subarray(0, 1)[0] & 0x7F;
    obfuscated_ctl_ttl_seq_src = network_pdu.subarray(1, 7);
    enc_dst = network_pdu.subarray(7, 9);
    enc_transport_pdu = network_pdu.subarray(9, network_pdu.length - 4);
    netmic = network_pdu.subarray(network_pdu.length - 4, network_pdu.length);
  
    hex_pdu_ivi = utils.intToHex(pdu_ivi);
    hex_pdu_nid = utils.intToHex(pdu_nid);
    hex_obfuscated_ctl_ttl_seq_src = utils.u8AToHexString(obfuscated_ctl_ttl_seq_src);
    hex_enc_dst = utils.u8AToHexString(enc_dst);
    hex_enc_transport_pdu = utils.u8AToHexString(enc_transport_pdu);
    //hex_netmic = utils.intToHex(netmic);
    hex_netmic = utils.u8AToHexString(netmic);

    // 3.4.6.3 Receiving a Network PDU
    // Upon receiving a message, the node shall check if the value of the NID field value matches one or more known NIDs
    if (hex_pdu_nid != this.hex_nid) {
        console.log("unknown nid - discarding");
        return;
    }
  
    console.log("enc_dst=" + hex_enc_dst);
    console.log("enc_transport_pdu=" + hex_enc_transport_pdu);
    console.log("NetMIC=" + hex_netmic);
  
    // -----------------------------------------------------
    // 2. Deobfuscate network PDU - ref 3.8.7.3
    // -----------------------------------------------------
    hex_privacy_random = crypto.privacyRandom(hex_enc_dst, hex_enc_transport_pdu, hex_netmic);
    console.log("Privacy Random=" + hex_privacy_random);
  
    deobfuscated = crypto.deobfuscate(hex_obfuscated_ctl_ttl_seq_src, this.iv_index, this.netkey, hex_privacy_random, this.hex_privacy_key);
    
    result = {};

    result.hex_enc_dst = utils.bytesToHex(enc_dst);
    result.hex_enc_transport_pdu = utils.bytesToHex(enc_transport_pdu);
    result.hex_netmic = utils.bytesToHex(netmic);
    result.hex_ctl_ttl_seq_src = deobfuscated.ctl_ttl_seq_src;

    return result;
}

proxyClient.prototype.decryptAndVerifyNetworkPdu = function (type, hex_deobfuscate) {
    // ref 3.8.7.2 Network layer authentication and encryption
  
    // -----------------------------------------------------
    // 3. Decrypt and verify network PDU - ref 3.8.5.1
    // -----------------------------------------------------
  

    hex_pdu_ctl_ttl = hex_deobfuscate.hex_ctl_ttl_seq_src.substring(0, 2);
  
    hex_pdu_seq = hex_deobfuscate.hex_ctl_ttl_seq_src.substring(2, 8);
    // NB: SEQ should be unique for each PDU received. We don't enforce this rule here to allow for testing with the same values repeatedly.
  
    hex_pdu_src = hex_deobfuscate.hex_ctl_ttl_seq_src.substring(8, 12);
    // validate SRC
    src_bytes = utils.hexToBytes(hex_pdu_src);
    src_value = src_bytes[0] + (src_bytes[1] << 8);
    if (src_value < 0x0001 || src_value > 0x7FFF) {
      console.log("SRC is not a valid unicast address. 0x0001-0x7FFF allowed. Ref 3.4.2.2");
      return;
    }
  
    ctl_int = (parseInt(hex_pdu_ctl_ttl, 16) & 0x80) >> 7;
    ttl_int = parseInt(hex_pdu_ctl_ttl, 16) & 0x7F;

    var sec = this.networkNonceMicSize(type, ctl_int, ttl_int, hex_pdu_seq, hex_pdu_src, this.iv_index);
  
    console.log("hex_enc_dst=" + hex_deobfuscate.hex_enc_dst);
    console.log("hex_enc_transport_pdu=" + hex_deobfuscate.hex_enc_transport_pdu);
    console.log("hex_netmic=" + hex_deobfuscate.hex_netmic);
  
    hex_enc_network_data = hex_deobfuscate.hex_enc_dst + hex_deobfuscate.hex_enc_transport_pdu + hex_deobfuscate.hex_netmic;
    console.log("decrypting and verifying network layer: " + hex_enc_network_data + " key: " + this.hex_encryption_key + " nonce: " + sec.hex_nonce);
    result = crypto.decryptAndVerify(this.hex_encryption_key, hex_enc_network_data, sec.hex_nonce, sec.mic_size);
    console.log("result=" + JSON.stringify(result));
    if (result.status == -1) {
      console.log("ERROR: "+result.error.message);
      return;
    }
  
    return result.hex_decrypted;
}

proxyClient.prototype.parseNetworkPdu = function (network_pdu) {
    
    // demarshall obfuscated network pdu
    pdu_ivi = network_pdu.subarray(0, 1)[0] & 0x80;
    pdu_nid = network_pdu.subarray(0, 1)[0] & 0x7F;
    obfuscated_ctl_ttl_seq_src = network_pdu.subarray(1, 7);
    enc_dst = network_pdu.subarray(7, 9);
    enc_transport_pdu = network_pdu.subarray(9, network_pdu.length - 4);
    netmic = network_pdu.subarray(network_pdu.length - 4, network_pdu.length);
  
    hex_pdu_ivi = utils.intToHex(pdu_ivi);
    hex_pdu_nid = utils.intToHex(pdu_nid);
    hex_obfuscated_ctl_ttl_seq_src = utils.u8AToHexString(obfuscated_ctl_ttl_seq_src);
    hex_enc_dst = utils.u8AToHexString(enc_dst);
    hex_enc_transport_pdu = utils.u8AToHexString(enc_transport_pdu);
    //hex_netmic = utils.intToHex(netmic);
    hex_netmic = utils.u8AToHexString(netmic);
  
    console.log("enc_dst=" + hex_enc_dst);
    console.log("enc_transport_pdu=" + hex_enc_transport_pdu);
    console.log("NetMIC=" + hex_netmic);
  
    // -----------------------------------------------------
    // 2. Deobfuscate network PDU - ref 3.8.7.3
    // -----------------------------------------------------
    hex_privacy_random = crypto.privacyRandom(hex_enc_dst, hex_enc_transport_pdu, hex_netmic);
    console.log("Privacy Random=" + hex_privacy_random);
  
    deobfuscated = crypto.deobfuscate(hex_obfuscated_ctl_ttl_seq_src, this.iv_index, this.netkey, hex_privacy_random, this.hex_privacy_key);
    hex_ctl_ttl_seq_src = deobfuscated.ctl_ttl_seq_src;
  
    // 3.4.6.3 Receiving a Network PDU
    // Upon receiving a message, the node shall check if the value of the NID field value matches one or more known NIDs
    if (hex_pdu_nid != this.hex_nid) {
      console.log("unknown nid - discarding");
      return;
    }
  
    hex_enc_dst = utils.bytesToHex(enc_dst);
    hex_enc_transport_pdu = utils.bytesToHex(enc_transport_pdu);
    hex_netmic = utils.bytesToHex(netmic);
  
  
    // ref 3.8.7.2 Network layer authentication and encryption
  
    // -----------------------------------------------------
    // 3. Decrypt and verify network PDU - ref 3.8.5.1
    // -----------------------------------------------------
  

    hex_pdu_ctl_ttl = hex_ctl_ttl_seq_src.substring(0, 2);
  
    hex_pdu_seq = hex_ctl_ttl_seq_src.substring(2, 8);
    // NB: SEQ should be unique for each PDU received. We don't enforce this rule here to allow for testing with the same values repeatedly.
  
    hex_pdu_src = hex_ctl_ttl_seq_src.substring(8, 12);
    // validate SRC
    src_bytes = utils.hexToBytes(hex_pdu_src);
    src_value = src_bytes[0] + (src_bytes[1] << 8);
    if (src_value < 0x0001 || src_value > 0x7FFF) {
      console.log("SRC is not a valid unicast address. 0x0001-0x7FFF allowed. Ref 3.4.2.2");
      return;
    }
  
    ctl_int = (parseInt(hex_pdu_ctl_ttl, 16) & 0x80) >> 7;
    ttl_int = parseInt(hex_pdu_ctl_ttl, 16) & 0x7F;
  
    console.log("hex_enc_dst=" + hex_enc_dst);
    console.log("hex_enc_transport_pdu=" + hex_enc_transport_pdu);
    console.log("hex_netmic=" + hex_netmic);
  
    hex_enc_network_data = hex_enc_dst + hex_enc_transport_pdu + hex_netmic;
    console.log("decrypting and verifying network layer: " + hex_enc_network_data + " key: " + hex_encryption_key + " nonce: " + hex_nonce);
    result = crypto.decryptAndVerify(hex_encryption_key, hex_enc_network_data, hex_nonce);
    console.log("result=" + JSON.stringify(result));
    if (result.status == -1) {
      console.log("ERROR: "+result.error.message);
      return;
    }
  
    hex_pdu_dst = result.hex_decrypted.substring(0, 4);
    lower_transport_pdu = result.hex_decrypted.substring(4, result.hex_decrypted.length);
    console.log("lower_transport_pdu=" + lower_transport_pdu);
  
    // lower transport layer: 3.5.2.1
    hex_pdu_seg_akf_aid = lower_transport_pdu.substring(0, 2);
    console.log("hex_pdu_seg_akf_aid=" + hex_pdu_seg_akf_aid);
    seg_int = (parseInt(hex_pdu_seg_akf_aid, 16) & 0x80) >> 7;
    akf_int = (parseInt(hex_pdu_seg_akf_aid, 16) & 0x40) >> 6;
    aid_int = parseInt(hex_pdu_seg_akf_aid, 16) & 0x3F;
  
    // upper transport: 3.6.2
  
    hex_enc_access_payload_transmic = lower_transport_pdu.substring(2, lower_transport_pdu.length);
    hex_enc_access_payload = hex_enc_access_payload_transmic.substring(0, hex_enc_access_payload_transmic.length - 8);
    hex_transmic = hex_enc_access_payload_transmic.substring(hex_enc_access_payload_transmic.length - 8, hex_enc_access_payload_transmic.length);
    console.log("enc_access_payload=" + hex_enc_access_payload);
    console.log("transmic=" + hex_transmic);
  
    // access payload: 3.7.3
    // derive Application Nonce (3.8.5.2)
    hex_app_nonce = "0100" + hex_pdu_seq + hex_pdu_src + hex_pdu_dst + this.iv_index;
    console.log("application nonce=" + hex_app_nonce);
  
    console.log("decrypting and verifying access layer: " + hex_enc_access_payload + hex_transmic + " key: " + hex_appkey + " nonce: " + hex_app_nonce);
    result = crypto.decryptAndVerify(hex_appkey, hex_enc_access_payload + hex_transmic, hex_app_nonce);
    console.log("result=" + JSON.stringify(result));
    if (result.status == -1) {
      console.log("ERROR: "+result.error.message);
      return;
    }
  
    console.log("access payload=" + result.hex_decrypted);
  
    hex_opcode_and_params = utils.getOpcodeAndParams(result.hex_decrypted);
    console.log("hex_opcode_and_params=" + JSON.stringify(hex_opcode_and_params));
    hex_opcode = hex_opcode_and_params.opcode;
    hex_params = hex_opcode_and_params.params;
    hex_company_code = hex_opcode_and_params.company_code
  
    console.log(" ");
    console.log("----------");
    console.log("Proxy PDU");
    console.log("  SAR=" + utils.intToHex(sar));
    console.log("  MESSAGE TYPE=" + utils.intToHex(msgtype));
    console.log("  NETWORK PDU");
    console.log("    IVI=" + hex_pdu_ivi);
    console.log("    NID=" + hex_pdu_nid);
    console.log("    CTL=" + utils.intToHex(ctl_int));
    console.log("    TTL=" + utils.intToHex(ttl_int));
    console.log("    SEQ=" + hex_pdu_seq);
    console.log("    SRC=" + hex_pdu_src);
    console.log("    DST=" + hex_pdu_dst);
    console.log("    Lower Transport PDU");
    console.log("      SEG=" + utils.intToHex(seg_int));
    console.log("      AKF=" + utils.intToHex(akf_int));
    console.log("      AID=" + utils.intToHex(aid_int));
    console.log("      Upper Transport PDU");
    console.log("        Access Payload");
    console.log("          opcode=" + hex_opcode);
    if (hex_company_code != "") {
      console.log("          company_code=" + hex_company_code);
    }
    console.log("          params=" + hex_params);
    console.log("        TransMIC=" + hex_transmic);
    console.log("    NetMIC=" + hex_netmic);
    
}

proxyClient.prototype.setFilterType = function (type)
{
    this.msg_type = 2;
    this.ctl = 1;
    this.ttl = "00";
    this.dst = "0000";

    var access_payload = "";
    if((type === 0x00) || (type === 0x01)) {
        access_payload = "00" + utils.toHex(type, 1); // "00" is filter type op code
    }
    else {
        console.log("Invalid filter type", type);
    }

    var secured_network_pdu = this.deriveSecureNetworkLayer(this.dst, access_payload);
    console.log("EncDST=" + JSON.stringify(secured_network_pdu.EncDST) + " EncTransportPDU=" + JSON.stringify(secured_network_pdu.EncTransportPDU));

    var obfuscated = this.obfuscateNetworkPdu(secured_network_pdu);
    console.log("obfuscated_ctl_ttl_seq_src=" + JSON.stringify(obfuscated.obfuscated_ctl_ttl_seq_src));

    var finalised_network_pdu = this.finaliseNetworkPdu(this.ivi, this.hex_nid, obfuscated.obfuscated_ctl_ttl_seq_src, secured_network_pdu.EncDST, secured_network_pdu.EncTransportPDU, network_pdu.NetMIC);
    console.log("finalised_network_pdu=" + finalised_network_pdu);

    var proxy_pdu = this.finaliseProxyPdu(finalised_network_pdu);
    console.log("proxy_pdu=" + proxy_pdu);

    this.chDataIn.write(Buffer.from(proxy_pdu, 'hex'), true, status => {
        console.log("setFilterType write callback status ", status);
    });
}


proxyClient.prototype.accessPayloadFilterType = function (type) {
    var access_payload = "";

    if((type === 0x00) || (type === 0x01)) {
        access_payload = "00" + utils.toHex(type, 1); // "00" is filter type op code
    }
    else {
        console.log("Invalid filter type", type);
    }

    return access_payload;

    /*
    if (document.getElementById("opcode_selection").value == "0000") {
        access_payload = document.getElementById("access_payload_hex").value;
    } else {
        access_payload = document.getElementById("opcode_selection").value;
        if (access_payload == "8202" || access_payload == "8203") {
            access_payload = access_payload + document.getElementById("onoff_selection").value;
            access_payload = access_payload + document.getElementById("tid_hex").value;
            tt = document.getElementById("trans_time_hex").value;
            if (tt != "00") {
                access_payload = access_payload + tt;
                access_payload = access_payload + document.getElementById("delay_hex").value;
            }
        }
    }
    return access_payload;
    */
};

proxyClient.prototype.deriveSecureUpperTransportPdu = function (access_payload) {
    upper_trans_pdu = {};
    switch(this.msg_type) {
        case 0:
            // derive Application Nonce (ref 3.8.5.2)
            app_nonce = "0100" + utils.toHex(this.seq, 3) + this.src + this.dst + this.iv_index;
            break;
        case 2:
            // derive Proxy Nonce (ref 3.8.5.4)
            app_nonce = "0300" + utils.toHex(this.seq, 3) + this.src + "0000" + this.iv_index;
            break;
        default:
            console.log("Unsupported message type");
            break;
    }
    upper_trans_pdu = crypto.meshAuthEncAccessPayload(this.A, app_nonce, access_payload);
    return upper_trans_pdu;
}

proxyClient.prototype.deriveLowerTransportPdu = function (upper_transport_pdu) {
    lower_transport_pdu = "";
    // seg=0 (1 bit), akf=1 (1 bit), aid (6 bits) already derived from k4
    seg_int = parseInt(this.seg, 16);
    akf_int = parseInt(this.akf, 16);
    aid_int = parseInt(this.aid, 16);
    ltpdu1 = (seg_int << 7) | (akf_int << 6) | aid_int;
    lower_transport_pdu = utils.intToHex(ltpdu1) + upper_transport_pdu.EncAccessPayload + upper_transport_pdu.TransMIC;
    return lower_transport_pdu;
};

proxyClient.prototype.deriveSecureNetworkLayer = function (hex_dst, lower_transport_pdu) {
    network_pdu = "";
    
    N = utils.normaliseHex(this.hex_encryption_key);

    if(this.msg_type === 0) {
        // Network nonce
        ctl_int = parseInt(this.ctl, 16);
        ttl_int = parseInt(this.ttl, 16);
        //ctl_ttl = (ctl_int | ttl_int);
        ctl_ttl = (ctl_int << 7) | ttl_int;
        npdu2 = utils.intToHex(ctl_ttl);
        nonce = "00" + npdu2 + utils.toHex(this.seq, 3) + this.src + "0000" + this.iv_index;

        micSize = 4;
    }
    else if(this.msg_type === 2) {
        // Proxy nonce
        nonce = "0300" + utils.toHex(this.seq, 3) + this.src + "0000" + this.iv_index;

        micSize = 8;
    }
    else {
        console.log("Error nonce type not implemented!!!");
    }

    console.log("net_nonce ", nonce);
    network_pdu = crypto.meshAuthEncNetwork(N, nonce, hex_dst, lower_transport_pdu, micSize);
    return network_pdu;
};

proxyClient.prototype.obfuscateNetworkPdu = function (network_pdu) {
    obfuscated = "";
    obfuscated = crypto.obfuscate(network_pdu.EncDST, network_pdu.EncTransportPDU, network_pdu.NetMIC,
        this.ctl, this.ttl, utils.toHex(this.seq, 3), this.src, this.iv_index, this.hex_privacy_key);
    return obfuscated;
};

proxyClient.prototype.finaliseNetworkPdu = function (ivi, nid, obfuscated_ctl_ttl_seq_src, enc_dst, enc_transport_pdu, netmic) {
    ivi_int = parseInt(ivi, 16);
    nid_int = parseInt(nid, 16);
    npdu1 = utils.intToHex((ivi_int << 7) | nid_int);
    netpdu = npdu1 + obfuscated_ctl_ttl_seq_src + enc_dst + enc_transport_pdu + netmic;
    return netpdu;
};

proxyClient.prototype.finaliseProxyPdu = function (finalised_network_pdu) {
    proxy_pdu = "";
    sm = (this.sar << 6) | this.msg_type;  //TBD msg type
    i = 0;
    proxy_pdu = proxy_pdu + utils.intToHex(sm);
    proxy_pdu = proxy_pdu + finalised_network_pdu;
    return proxy_pdu;
};


proxyClient.prototype.deriveProxyPdu = function (access_payload) {
    console.log("deriveProxyPdu");
    valid_pdu = true;
    // access payload
    //access_payload = app.deriveAccessPayload();
    //console.log("access_payload=" + access_payload);

    // upper transport PDU
    upper_transport_pdu_obj = this.deriveSecureUpperTransportPdu(access_payload);
    upper_transport_pdu = upper_transport_pdu_obj.EncAccessPayload + upper_transport_pdu_obj.TransMIC;
    console.log("upper_transport_pdu=" + upper_transport_pdu);
    transmic = upper_transport_pdu_obj.TransMIC;
    //document.getElementById("trans_mic").innerHTML = "0x" + upper_transport_pdu_obj.TransMIC;

    // derive lower transport PDU
    lower_transport_pdu = this.deriveLowerTransportPdu(upper_transport_pdu_obj);
    console.log("lower_transport_pdu=" + lower_transport_pdu);

    // encrypt network PDU
    hex_dst = this.dst; //TBD?? //document.getElementById('dst').value;
    secured_network_pdu = this.deriveSecureNetworkLayer(hex_dst, lower_transport_pdu);
    console.log("EncDST=" + JSON.stringify(secured_network_pdu.EncDST) + " EncTransportPDU=" + JSON.stringify(secured_network_pdu.EncTransportPDU));
    netmic = secured_network_pdu.NetMIC;
    //document.getElementById("net_mic").innerHTML = "0x" + secured_network_pdu.NetMIC;

    // obfuscate
    obfuscated = this.obfuscateNetworkPdu(secured_network_pdu);
    console.log("obfuscated_ctl_ttl_seq_src=" + JSON.stringify(obfuscated.obfuscated_ctl_ttl_seq_src));

    // finalise network PDU
    finalised_network_pdu = this.finaliseNetworkPdu(this.ivi, this.hex_nid, obfuscated.obfuscated_ctl_ttl_seq_src, secured_network_pdu.EncDST, secured_network_pdu.EncTransportPDU, network_pdu.NetMIC);
    console.log("finalised_network_pdu=" + finalised_network_pdu);
    //document.getElementById("network_pdu_hex").innerHTML = "0x" + finalised_network_pdu;
    //document.getElementById('hdg_network_pdu').innerHTML = "Network PDU - " + (finalised_network_pdu.length / 2) + " octets";

    // finalise proxy PDU
    proxy_pdu = this.finaliseProxyPdu(finalised_network_pdu);
    console.log("proxy_pdu=" + proxy_pdu);
    //document.getElementById('proxy_pdu_hex').innerHTML = "0x" + proxy_pdu;
    //document.getElementById('hdg_proxy_pdu').innerHTML = "Proxy PDU - " + (proxy_pdu.length / 2) + " octets";

    if (proxy_pdu.length > (this.mtu * 2)) { // hex chars
        console.log("Segmentation required (PDU length > MTU)");
        //app.showMessageRed("Segmentation required ( PDU length > MTU)");
        //alert("Segmentation required ( PDU length > MTU)");
        valid_pdu = false;
        //app.disableButton('btn_submit');

        proxy_pdu = "";
    }

    return proxy_pdu;
}

module.exports = proxyClient;