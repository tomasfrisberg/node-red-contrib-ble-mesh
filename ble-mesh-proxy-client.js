var noble = require('@abandonware/noble');
var utils = require('./utils.js');
var crypto = require('./crypto.js');
var debug = require('debug')('ble-mesh-proxy-client');

const  State = {
    OFF: 1,

    ON_IDLE: 2,
    ON_WAIT_DISCONNECT: 3,

    ON_CONNECTING_WAIT_CONNECT: 10,
    ON_CONNECTING_WAIT_DISCOVER: 11,
    ON_CONNECTING_WAIT_SECURE_NETWORK_BEACON: 12,
    ON_CONNECTING_WAIT_FILTER_TYPE_STATUS: 13,

    ON_CONNECTED_IDLE: 20,
    ON_CONNECTED_WAIT_FILTER_ADDR_STATUS: 21
};

function ProxyClient(hexNetKey, hexAppKey, hexSrcAddr, callb)
{
    this.name = "no-name";
    this.state = State.OFF;
    this.scanning = false;
    this.statusCallback = callb.statusCallback;
    this.scanCallback = callb.scanCallback;
    this.dataCallback = callb.dataCallback;

    this.MESH_PROXY_SERVICE = '1828'; //'00001828-0000-1000-8000-00805f9b34fb';
    this.MESH_PROXY_DATA_IN = '2add'; //'00002add-0000-1000-8000-00805f9b34fb';
    this.MESH_PROXY_DATA_OUT = '2ade'; //'00002ade-0000-1000-8000-00805f9b34fb';

    this.iv_index = "00000000"; //"12345677";
    this.netkey = hexNetKey; //"5F5F6E6F726469635F5F73656D695F5F";
    this.appkey = hexAppKey; //"5F116E6F726469635F5F73656D695F5F";
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
    this.seq = 40; //460840; // 0x0x07080a 
    this.src = hexSrcAddr; //"1237";
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

    this.hexSubscribeAddr = "";

    debug("hex_encryption_key ", this.hex_encryption_key);
    debug("hex_privacy_key ", this.hex_privacy_key);

    if(noble.state == "poweredOn") {
        this.state = State.ON_IDLE;
    }

    noble.on('stateChange', (state) => {
        debug(this.name + ": State " + state);
        switch(state) {
        case "poweredOn":
            if(this.state === State.OFF) {
                this.state = State.ON_IDLE;
                this.statusCallback("On");
            }
            break;
        case "poweredOff":
            if(this.state !== State.OFF) {
                this.state = State.OFF;
                this.scanning = false;
                this.statusCallback("Off");
            }
            break;
        }
    });
    noble.on('scanStart',  () => {
        debug("noble.on: ScanStart");
    });
    noble.on('scanStop', () => {
        debug("noble.on: ScanStop");
    });
    noble.on('discover', (peripheral) => {
        if(this.scanCallback && this.scanning) {
            this.scanCallback(peripheral);
        }
    });
    noble.on('warning', (msg) => {
        debug("noble.on: Warning " + msg);
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

ProxyClient.prototype.isOn = function() {
    var on = false;
    if(this.state !== State.OFF) {
        on = true;
    }
    else {
        if(noble.state === "poweredOn") {
            this.state = State.ON_IDLE;
            on = true;
        }
    }
    return on;
}

ProxyClient.prototype.startScanning = function ()
{
    if((this.state !== State.OFF) && !this.scanning) {
        //this.scanCallback = callback;
        this.scanning = true;

        noble.startScanning(['1828'], true);
    }
    //noble.startScanning([0x1828], true, (errMsg) => {
    //        debug(this.name + ": startScanning " + errMsg);
    //});
}

ProxyClient.prototype.stopScanning = function ()
{
    if((this.state !== State.OFF) && this.scanning) {
        this.scanning = false;
        noble.stopScanning();
    }
}

ProxyClient.prototype.connect = function(peripheral)
{
    switch(this.state) {
    case State.ON_IDLE:
        this.state = State.ON_CONNECTING_WAIT_CONNECT;
        this.peripheral = peripheral;

        this.peripheral.connect(error => {
            if(!error) {
                this.peripheral.once('disconnect', () => {
                    this.state = State.ON_IDLE;
                    this.peripheral = null;
                    this.chDataIn = null;
                    this.chDataOut = null;
                    this.statusCallback("Disconnected");
                });

                debug('Connected to', peripheral.advertisement.localName);

                if(this.state === State.ON_CONNECTING_WAIT_CONNECT) {
                    // specify the services and characteristics to discover
                    const serviceUUIDs = [this.MESH_PROXY_SERVICE];
                    const characteristicUUIDs = [this.MESH_PROXY_DATA_IN, this.MESH_PROXY_DATA_OUT];
                
                    this.state = State.ON_CONNECTING_WAIT_DISCOVER;
                    this.peripheral.discoverSomeServicesAndCharacteristics(
                        serviceUUIDs,
                        characteristicUUIDs,
                        onServicesAndCharacteristicsDiscovered.bind(this)
                    ); 
                }
                else {
                    this.peripheral.disconnect();
                    if(State.ON_WAIT_DISCONNECT) {
                        this.state = State.ON_IDLE;
                    }
                    else {
                        debug("Warning: Connect in unexpected state " + this.state);
                    }
                }
            }
            else {
                this.state = State.ON_IDLE;
                this.peripheral = null;
                this.chDataIn = null;
                this.chDataOut = null;

                this.statusCallback("Disconnected");

                debug("connect: ", error);
            }
        });
        break;
    default:
        debug("connect: invalid state");
        break;
    }
}

ProxyClient.prototype.disconnect = function() {
    switch(this.state) {
        case State.ON_CONNECTING_WAIT_DISCOVER:
            this.state = State.ON_WAIT_DISCONNECT;
            break;
        case State.ON_CONNECTING_WAIT_CONNECT:
        case State.ON_CONNECTING_WAIT_FILTER_TYPE_STATUS:
        case State.ON_CONNECTING_WAIT_SECURE_NETWORK_BEACON:
        case State.ON_CONNECTED_IDLE:
        case State.ON_CONNECTED_WAIT_FILTER_ADDR_STATUS:
            this.peripheral.disconnect();
            this.state = State.ON_IDLE;
            break;
    }
}

ProxyClient.prototype.subscribe = function (hexAddr) {
    var ok = false;
    if((hexAddr.length % 4) === 0) {
        switch(this.state) {
        case State.ON_CONNECTED_IDLE:
            this.seq = this.seq + 1; // TODO: ??
            ok = this.setFilterAddr(hexAddr);
            if(ok) {
                this.state = State.ON_CONNECTED_WAIT_FILTER_ADDR_STATUS;
            }
            break;
        case State.ON_CONNECTED_WAIT_FILTER_ADDR_STATUS:
            this.hexSubscribeAddr = this.hexSubscribeAddr + hexAddr;
            ok = true;
            break;
        default:
            debug("subscribe: Invalid state");
            break;
        }
    }
    return ok;
}

ProxyClient.prototype.publish = function (hexAddr, hexOpCode, hexPars) {

    var ok = false;

    if( (hexAddr.length === 4) &&
        ((hexOpCode.length === 2) || (hexOpCode.length === 4) || (hexOpCode.length === 6)) &&
        ((hexPars === null) || (hexPars.length % 2 === 0))) {

        this.msg_type = 0;  // Network PDU
        this.ctl = 0;       // Access message
        this.ttl = "04";    
        this.dst = hexAddr;
        this.seq = this.seq + 1; // TODO: ??

        var access_payload = hexOpCode + hexPars;

        var upper_transport_pdu_obj = this.deriveSecureUpperTransportPdu(access_payload);
        var upper_transport_pdu = upper_transport_pdu_obj.EncAccessPayload + upper_transport_pdu_obj.TransMIC;
        debug("upper_transport_pdu=" + upper_transport_pdu);
        //transmic = upper_transport_pdu_obj.TransMIC;

        // derive lower transport PDU
        var lower_transport_pdu = this.deriveLowerTransportPdu(upper_transport_pdu_obj);
        debug("lower_transport_pdu=" + lower_transport_pdu);

        var secured_network_pdu = this.deriveSecureNetworkLayer(this.dst, lower_transport_pdu);
        debug("EncDST=" + JSON.stringify(secured_network_pdu.EncDST) + " EncTransportPDU=" + JSON.stringify(secured_network_pdu.EncTransportPDU));

        var obfuscated = this.obfuscateNetworkPdu(secured_network_pdu);
        debug("obfuscated_ctl_ttl_seq_src=" + JSON.stringify(obfuscated.obfuscated_ctl_ttl_seq_src));

        var finalised_network_pdu = this.finaliseNetworkPdu(this.ivi, this.hex_nid, obfuscated.obfuscated_ctl_ttl_seq_src, secured_network_pdu.EncDST, secured_network_pdu.EncTransportPDU, network_pdu.NetMIC);
        debug("finalised_network_pdu=" + finalised_network_pdu);

        var proxy_pdu = this.finaliseProxyPdu(finalised_network_pdu);
        debug("proxy_pdu=" + proxy_pdu);

        this.chDataIn.write(Buffer.from(proxy_pdu, 'hex'), true, status => {
            debug("publish write callback status ", status);
        });

        ok = true;
    }
    else {
        debug("publish: Invalid input params");
    }

    return ok;

}

function onServicesAndCharacteristicsDiscovered(error, services, characteristics)
{
    switch(this.state) {
    case State.ON_CONNECTING_WAIT_DISCOVER:
        debug("Discovered services and characteristics", error, services.length, characteristics.length);

        characteristics.forEach(ch => {
            if(ch.uuid === this.MESH_PROXY_DATA_IN) {
                this.chDataIn = ch;
            }
            if(ch.uuid === this.MESH_PROXY_DATA_OUT) {
                this.chDataOut = ch;

                this.chDataOut.on("data", onCharacteristicData.bind(this));
                //this.chDataOut.on('read', onCharacteristicData.bind(this));

                this.chDataOut.subscribe(error => {
                    if(error) {
                        debug("Subscribe ", error);
                    }
                });

                this.state = State.ON_CONNECTING_WAIT_SECURE_NETWORK_BEACON;
            }
        });
        break;
    case State.ON_WAIT_DISCONNECT:
        this.peripheral.disconnect();
        this.state = State.ON_IDLE;
        break;
    default:
        debug("onServicesAndCharacteristicsDiscovered: Warning unexpected state " + this.state);
        break;
    }
}

function onCharacteristicData(data, isNotification)
{
    //TODO: Check states

    // length validation
    if (data.length > 0) {
  
        // -----------------------------------------------------
        // 1. Extract proxy PDU fields : SAR, msgtype, data
        // -----------------------------------------------------
        var sar_msgtype = data.subarray(0, 1)[0];
        debug("sar_msgtype = ", sar_msgtype);
        var sar = (sar_msgtype & 0xC0) >> 6;
        if (sar < 0 || sar > 3) {
            debug("SAR contains invalid value. 0-3 allowed. Ref Table 6.2");
            return;
        }
        
        var msgtype = sar_msgtype & 0x3F;
        if (msgtype < 0 || msgtype > 3) {
            debug("Message Type contains invalid value. 0x00-0x03 allowed. Ref Table 6.3");
            return;
        }
    
        // See table 3.7 for min length of network PDU and 6.1 for proxy PDU length
        if (data.length < 15) {
            debug("PDU is too short (min 15 bytes) - ", data.length, " bytes received");
            return;
        }
    
        var network_pdu = null;
        network_pdu = data.subarray(1, data.length);
    
        debug("Proxy PDU: SAR = ", utils.intToHex(sar), " MSGTYPE = ", utils.intToHex(msgtype), " NETWORK PDU = ", utils.u8AToHexString(network_pdu));
    
        switch(msgtype) {
        case 0x00:
            // Network PDU
            debug("Network PDU");
            this.parseNetworkPdu(network_pdu);
            break;
        case 0x01:
            // Mesh beacon
            debug("Mesh Beacon");
            this.parseMeshBeacon(network_pdu);
            break;
        case 0x02:
            // Proxy configuration
            debug("Proxy Configuration");
            this.parseProxyConfiguration(network_pdu);
            break;
        case 0x03:
            // Provisioning PDU
            debug("Provisioning PDU not supported");
            break;
        default:
            // RFU
            debug("RFU not supported");
            break;
        }
    }
    else {
        debug("Error: No data received");
    }
}

ProxyClient.prototype.parseMeshBeacon = function (network_pdu) {
    if(network_pdu[0] == 0x01) {

        var nId = utils.u8AToHexString(network_pdu.subarray(2, 10));

        //TODO: verify authentication value

        if(nId === this.network_id) {
            debug("Secure network beacon");

            this.iv_index = utils.u8AToHexString(network_pdu.subarray(10, 14));
            this.I = utils.normaliseHex(this.iv_index);
            this.ivi = utils.leastSignificantBit(parseInt(this.I, 16));

            switch(this.state) {
            case State.ON_CONNECTING_WAIT_SECURE_NETWORK_BEACON:
                this.state = State.ON_CONNECTING_WAIT_FILTER_TYPE_STATUS;
                this.seq = this.seq + 1; // TODO: ??
                this.setFilterType(0x00);
                break;
            default:
                break;
            }
        }
    }
}

ProxyClient.prototype.networkNonceMicSize = function(msgType, ctl, ttl, hex_seq, hex_src, hex_iv_index) {
    var result = {};

    switch(msgType) {
        case 0:
            // Network nonce
            ctl_int = parseInt(ctl, 16);
            ttl_int = parseInt(ttl, 16);
            ctl_ttl = (ctl_int << 7) | ttl_int;
            hex_npdu2 = utils.intToHex(ctl_ttl);
            result.hex_nonce = "00" + hex_npdu2 + hex_seq + hex_src + "0000" + hex_iv_index;
            result.mic_size = 4;
            break;
        case 2:
            // Proxy nonce
            result.hex_nonce = "0300" + hex_seq + hex_src + "0000" + hex_iv_index;
            result.mic_size = 8;
            break;
        default:
            debug("ERROR nonce not implemented");
            break;
    }

    return result;
}

ProxyClient.prototype.parseNetworkPdu = function(network_pdu) {

    var hex_op_code = "";
    var hex_deobfuscate = this.deobfuscateNetworkPdu(network_pdu);
    var result = {};
    
    result = this.decryptAndVerifyNetworkPdu(0, hex_deobfuscate);
    var hex_decrypted = result.hex_decrypted;
    var hex_seq = result.hex_pdu_seq;
    var hex_src = result.hex_pdu_src;

    result = this.decryptAndVerifyAccessPayload(hex_seq, hex_src, hex_decrypted);


    switch(this.state) {
    case State.ON_CONNECTED_IDLE:
    case State.ON_CONNECTED_WAIT_FILTER_ADDR_STATUS:
        this.dataCallback(result);
        break;
    default:
        break;            
    }
}

ProxyClient.prototype.parseProxyConfiguration = function(network_pdu) {

    var hex_op_code = "";
    var hex_deobfuscate = this.deobfuscateNetworkPdu(network_pdu);
    var result = this.decryptAndVerifyNetworkPdu(2, hex_deobfuscate);
    var hex_decrypted = result.hex_decrypted;

    if(hex_decrypted.substring(0, 4) === "0000") {
        // Destination address must be non-valid
        hex_op_code = hex_decrypted.substring(4, 6);
        switch(hex_op_code) {
        case "03":
            // Filter type status
            var hex_filter_type = hex_decrypted.substring(6, 8);
            var hex_list_size = hex_decrypted.substring(8, 12);

            debug("hex_op_code ", hex_op_code, " hex_filter_type ", hex_filter_type, " hex_list_size ", hex_list_size);
            break;
        default:
            debug("Unknown op code ", hex_op_code);
            break;
        }
    }
    else {
        debug("Non-valid destination address ", hex_decrypted.substring(0, 4));
    }

    switch(this.state) {
    case State.ON_CONNECTING_WAIT_FILTER_TYPE_STATUS:
        if(hex_op_code === "03") {
            this.state = State.ON_CONNECTED_IDLE;
            this.statusCallback("Connected");
        }
        break;
    case State.ON_CONNECTED_WAIT_FILTER_ADDR_STATUS:
        if(hex_op_code === "03") {
            if(this.hexSubscribeAddr === "") {
                this.state = State.ON_CONNECTED_IDLE;
            }
            else {
                var ok = this.setFilterAddr(this.hexSubscribeAddr);
                if(ok) {
                    this.hexSubscribeAddr = "";
                    // Remain in state
                }
            }
        }
        break;
    default:
        break;            
    }
}

ProxyClient.prototype.deobfuscateNetworkPdu = function (network_pdu) {
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
        debug("unknown nid - discarding");
        return;
    }
  
    debug("enc_dst=" + hex_enc_dst);
    debug("enc_transport_pdu=" + hex_enc_transport_pdu);
    debug("NetMIC=" + hex_netmic);
  
    // -----------------------------------------------------
    // 2. Deobfuscate network PDU - ref 3.8.7.3
    // -----------------------------------------------------
    hex_privacy_random = crypto.privacyRandom(hex_enc_dst, hex_enc_transport_pdu, hex_netmic);
    debug("Privacy Random=" + hex_privacy_random);
  
    deobfuscated = crypto.deobfuscate(hex_obfuscated_ctl_ttl_seq_src, this.iv_index, this.netkey, hex_privacy_random, this.hex_privacy_key);
    
    result = {};

    result.hex_enc_dst = utils.bytesToHex(enc_dst);
    result.hex_enc_transport_pdu = utils.bytesToHex(enc_transport_pdu);
    result.hex_netmic = utils.bytesToHex(netmic);
    result.hex_ctl_ttl_seq_src = deobfuscated.ctl_ttl_seq_src;

    return result;
}

ProxyClient.prototype.decryptAndVerifyNetworkPdu = function (type, hex_deobfuscate) {
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
      debug("SRC is not a valid unicast address. 0x0001-0x7FFF allowed. Ref 3.4.2.2");
      return;
    }
  
    ctl_int = (parseInt(hex_pdu_ctl_ttl, 16) & 0x80) >> 7;
    ttl_int = parseInt(hex_pdu_ctl_ttl, 16) & 0x7F;

    var sec = this.networkNonceMicSize(type, ctl_int, ttl_int, hex_pdu_seq, hex_pdu_src, this.iv_index);
  
    debug("hex_enc_dst=" + hex_deobfuscate.hex_enc_dst);
    debug("hex_enc_transport_pdu=" + hex_deobfuscate.hex_enc_transport_pdu);
    debug("hex_netmic=" + hex_deobfuscate.hex_netmic);
  
    hex_enc_network_data = hex_deobfuscate.hex_enc_dst + hex_deobfuscate.hex_enc_transport_pdu + hex_deobfuscate.hex_netmic;
    debug("decrypting and verifying network layer: " + hex_enc_network_data + " key: " + this.hex_encryption_key + " nonce: " + sec.hex_nonce);
    result = crypto.decryptAndVerify(this.hex_encryption_key, hex_enc_network_data, sec.hex_nonce, sec.mic_size);
    debug("result=" + JSON.stringify(result));
    if (result.status == -1) {
      debug("ERROR: "+result.error.message);
      return;
    }

    var res = {};
    res.hex_pdu_seq = hex_pdu_seq;
    res.hex_pdu_src = hex_pdu_src;
    res.hex_decrypted = result.hex_decrypted;
  
    return res;
}

ProxyClient.prototype.decryptAndVerifyAccessPayload = function (hex_pdu_seq, hex_pdu_src, hex_decrypted) {
    var hex_pdu_dst = hex_decrypted.substring(0, 4);
    var lower_transport_pdu = hex_decrypted.substring(4, hex_decrypted.length);
    debug("lower_transport_pdu = ", lower_transport_pdu);
  
    // lower transport layer: 3.5.2.1
    var hex_pdu_seg_akf_aid = lower_transport_pdu.substring(0, 2);
    debug("hex_pdu_seg_akf_aid = ", hex_pdu_seg_akf_aid);

    var seg_int = (parseInt(hex_pdu_seg_akf_aid, 16) & 0x80) >> 7;
    var akf_int = (parseInt(hex_pdu_seg_akf_aid, 16) & 0x40) >> 6;
    var aid_int = parseInt(hex_pdu_seg_akf_aid, 16) & 0x3F;
  
    // upper transport: 3.6.2
  
    var hex_enc_access_payload_transmic = lower_transport_pdu.substring(2, lower_transport_pdu.length);
    var hex_enc_access_payload = hex_enc_access_payload_transmic.substring(0, hex_enc_access_payload_transmic.length - 8);
    var hex_transmic = hex_enc_access_payload_transmic.substring(hex_enc_access_payload_transmic.length - 8, hex_enc_access_payload_transmic.length);
    debug("enc_access_payload = ", hex_enc_access_payload);
    debug("transmic = ", hex_transmic);
  
    // access payload: 3.7.3
    // derive Application Nonce (3.8.5.2)
    hex_app_nonce = "0100" + hex_pdu_seq + hex_pdu_src + hex_pdu_dst + this.iv_index;
    debug("application nonce=" + hex_app_nonce);
  
    debug("decrypting and verifying access layer: " + hex_enc_access_payload + hex_transmic + " key: " + this.appkey + " nonce: " + hex_app_nonce);
    result = crypto.decryptAndVerify(this.appkey, hex_enc_access_payload + hex_transmic, hex_app_nonce, 4);
    debug("result = ", JSON.stringify(result));
    if (result.status == -1) {
      debug("ERROR: ", result.error.message);
      return;
    }
  
    debug("access payload = ", hex_decrypted);
  
    var hex_opcode_and_params = this.getOpcodeAndParams(result.hex_decrypted);
    debug("hex_opcode_and_params = ", JSON.stringify(hex_opcode_and_params));

    var res = {};
    res.hex_seq = hex_pdu_seq;
    res.hex_src = hex_pdu_src;
    res.hex_dst = hex_pdu_dst;
    res.hex_opcode = hex_opcode_and_params.opcode;
    res.hex_company_code = hex_opcode_and_params.company_code
    res.hex_params = hex_opcode_and_params.params;

    return res;
}

ProxyClient.prototype.getOpcodeAndParams = function(hex_access_payload) {
    // ref 3.7.3.1
    result = {
        opcode: "",
        params: "",
        company_code: "",
        status: -1,
        message: "Invalid parameter length"
    };
    if (hex_access_payload.length < 2) {
        return result;
    }
    byte1 = parseInt(hex_access_payload.substring(0, 2), 16);
    if ((byte1 & 0x7F) == 0x7F) {
        result.message = "Opcode value is reserved for future use";
        return result;
    }
    result.status = 0;
    result.message = "OK";
    opcode_len = 1;
    if ((byte1 & 0x80) == 0x80 && (byte1 & 0x40) != 0x40) {
        opcode_len = 2;
    } else if ((byte1 & 0x80) == 0x80 && (byte1 & 0x40) == 0x40) {
        opcode_len = 3;
    }
    opcode_part = hex_access_payload.substring(0, (2 * opcode_len));
    company_code = "";
    if (opcode_len == 3) {
        company_code = opcode_part.substring(2, 6);
        opcode_part = opcode_part.substring(0, 2);
        opcode = parseInt(opcode_part, 16);
        result.company_code = company_code;
        result.opcode = utils.toHex(opcode, 1);
    } else if (opcode_len == 2) {
        opcode = parseInt(opcode_part, 16);
        result.opcode = utils.toHex(opcode, 2);
    } else {
        opcode = parseInt(opcode_part, 16);
        result.opcode = utils.toHex(opcode, 1);
    }
    result.params = hex_access_payload.substring((2 * opcode_len), hex_access_payload.length);
    return result;
}


ProxyClient.prototype.setFilterType = function (type)
{
    var ok = false;

    this.msg_type = 2;
    this.ctl = 1;
    this.ttl = "00";
    this.dst = "0000";

    var access_payload = "";
    if((type === 0x00) || (type === 0x01)) {
        access_payload = "00" + utils.toHex(type, 1); // "00" is filter type op code

        var secured_network_pdu = this.deriveSecureNetworkLayer(this.dst, access_payload);
        debug("EncDST=" + JSON.stringify(secured_network_pdu.EncDST) + " EncTransportPDU=" + JSON.stringify(secured_network_pdu.EncTransportPDU));

        var obfuscated = this.obfuscateNetworkPdu(secured_network_pdu);
        debug("obfuscated_ctl_ttl_seq_src=" + JSON.stringify(obfuscated.obfuscated_ctl_ttl_seq_src));

        var finalised_network_pdu = this.finaliseNetworkPdu(this.ivi, this.hex_nid, obfuscated.obfuscated_ctl_ttl_seq_src, secured_network_pdu.EncDST, secured_network_pdu.EncTransportPDU, network_pdu.NetMIC);
        debug("finalised_network_pdu=" + finalised_network_pdu);

        var proxy_pdu = this.finaliseProxyPdu(finalised_network_pdu);
        debug("proxy_pdu=" + proxy_pdu);

        this.chDataIn.write(Buffer.from(proxy_pdu, 'hex'), true, status => {
            debug("setFilterType write callback status ", status);
        });

        ok = true;
    }
    else {
        debug("Invalid filter type", type);
    }

    return ok;
}

ProxyClient.prototype.setFilterAddr = function (hexAddr)
{
    var ok = false;

    if((hexAddr.length % 4) === 0) {
        // Valid hex address list

        this.msg_type = 2;
        this.ctl = 1;
        this.ttl = "00";
        this.dst = "0000";

        var access_payload = "01" + hexAddr;

        var secured_network_pdu = this.deriveSecureNetworkLayer(this.dst, access_payload);
        debug("EncDST=" + JSON.stringify(secured_network_pdu.EncDST) + " EncTransportPDU=" + JSON.stringify(secured_network_pdu.EncTransportPDU));

        var obfuscated = this.obfuscateNetworkPdu(secured_network_pdu);
        debug("obfuscated_ctl_ttl_seq_src=" + JSON.stringify(obfuscated.obfuscated_ctl_ttl_seq_src));

        var finalised_network_pdu = this.finaliseNetworkPdu(this.ivi, this.hex_nid, obfuscated.obfuscated_ctl_ttl_seq_src, secured_network_pdu.EncDST, secured_network_pdu.EncTransportPDU, network_pdu.NetMIC);
        debug("finalised_network_pdu=" + finalised_network_pdu);

        var proxy_pdu = this.finaliseProxyPdu(finalised_network_pdu);
        debug("proxy_pdu=" + proxy_pdu);

        this.chDataIn.write(Buffer.from(proxy_pdu, 'hex'), true, status => {
            debug("setFilterType write callback status ", status);
        });

        ok = true;
    }

    return ok;
}

ProxyClient.prototype.deriveSecureUpperTransportPdu = function (access_payload) {
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
            debug("Unsupported message type");
            break;
    }
    upper_trans_pdu = crypto.meshAuthEncAccessPayload(this.A, app_nonce, access_payload);
    return upper_trans_pdu;
}

ProxyClient.prototype.deriveLowerTransportPdu = function (upper_transport_pdu) {
    lower_transport_pdu = "";
    // seg=0 (1 bit), akf=1 (1 bit), aid (6 bits) already derived from k4
    seg_int = parseInt(this.seg, 16);
    akf_int = parseInt(this.akf, 16);
    aid_int = parseInt(this.aid, 16);
    ltpdu1 = (seg_int << 7) | (akf_int << 6) | aid_int;
    lower_transport_pdu = utils.intToHex(ltpdu1) + upper_transport_pdu.EncAccessPayload + upper_transport_pdu.TransMIC;
    return lower_transport_pdu;
};

ProxyClient.prototype.deriveSecureNetworkLayer = function (hex_dst, lower_transport_pdu) {
    network_pdu = "";
    
    N = utils.normaliseHex(this.hex_encryption_key);

    if(this.msg_type === 0) {
        // Network nonce
        ctl_int = parseInt(this.ctl, 16);
        ttl_int = parseInt(this.ttl, 16);
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
        debug("Error nonce type not implemented!!!");
    }

    debug("net_nonce ", nonce);
    network_pdu = crypto.meshAuthEncNetwork(N, nonce, hex_dst, lower_transport_pdu, micSize);
    return network_pdu;
};

ProxyClient.prototype.obfuscateNetworkPdu = function (network_pdu) {
    obfuscated = "";
    obfuscated = crypto.obfuscate(network_pdu.EncDST, network_pdu.EncTransportPDU, network_pdu.NetMIC,
        this.ctl, this.ttl, utils.toHex(this.seq, 3), this.src, this.iv_index, this.hex_privacy_key);
    return obfuscated;
};

ProxyClient.prototype.finaliseNetworkPdu = function (ivi, nid, obfuscated_ctl_ttl_seq_src, enc_dst, enc_transport_pdu, netmic) {
    ivi_int = parseInt(ivi, 16);
    nid_int = parseInt(nid, 16);
    npdu1 = utils.intToHex((ivi_int << 7) | nid_int);
    netpdu = npdu1 + obfuscated_ctl_ttl_seq_src + enc_dst + enc_transport_pdu + netmic;
    return netpdu;
};

ProxyClient.prototype.finaliseProxyPdu = function (finalised_network_pdu) {
    proxy_pdu = "";
    sm = (this.sar << 6) | this.msg_type;  //TBD msg type
    i = 0;
    proxy_pdu = proxy_pdu + utils.intToHex(sm);
    proxy_pdu = proxy_pdu + finalised_network_pdu;
    return proxy_pdu;
};


ProxyClient.prototype.deriveProxyPdu = function (access_payload) {
    debug("deriveProxyPdu");
    valid_pdu = true;
    // access payload
    //access_payload = app.deriveAccessPayload();
    //debug("access_payload=" + access_payload);

    // upper transport PDU
    upper_transport_pdu_obj = this.deriveSecureUpperTransportPdu(access_payload);
    upper_transport_pdu = upper_transport_pdu_obj.EncAccessPayload + upper_transport_pdu_obj.TransMIC;
    debug("upper_transport_pdu=" + upper_transport_pdu);
    transmic = upper_transport_pdu_obj.TransMIC;
    //document.getElementById("trans_mic").innerHTML = "0x" + upper_transport_pdu_obj.TransMIC;

    // derive lower transport PDU
    lower_transport_pdu = this.deriveLowerTransportPdu(upper_transport_pdu_obj);
    debug("lower_transport_pdu=" + lower_transport_pdu);

    // encrypt network PDU
    hex_dst = this.dst; //TBD?? //document.getElementById('dst').value;
    secured_network_pdu = this.deriveSecureNetworkLayer(hex_dst, lower_transport_pdu);
    debug("EncDST=" + JSON.stringify(secured_network_pdu.EncDST) + " EncTransportPDU=" + JSON.stringify(secured_network_pdu.EncTransportPDU));
    netmic = secured_network_pdu.NetMIC;
    //document.getElementById("net_mic").innerHTML = "0x" + secured_network_pdu.NetMIC;

    // obfuscate
    obfuscated = this.obfuscateNetworkPdu(secured_network_pdu);
    debug("obfuscated_ctl_ttl_seq_src=" + JSON.stringify(obfuscated.obfuscated_ctl_ttl_seq_src));

    // finalise network PDU
    finalised_network_pdu = this.finaliseNetworkPdu(this.ivi, this.hex_nid, obfuscated.obfuscated_ctl_ttl_seq_src, secured_network_pdu.EncDST, secured_network_pdu.EncTransportPDU, network_pdu.NetMIC);
    debug("finalised_network_pdu=" + finalised_network_pdu);
    //document.getElementById("network_pdu_hex").innerHTML = "0x" + finalised_network_pdu;
    //document.getElementById('hdg_network_pdu').innerHTML = "Network PDU - " + (finalised_network_pdu.length / 2) + " octets";

    // finalise proxy PDU
    proxy_pdu = this.finaliseProxyPdu(finalised_network_pdu);
    debug("proxy_pdu=" + proxy_pdu);
    //document.getElementById('proxy_pdu_hex').innerHTML = "0x" + proxy_pdu;
    //document.getElementById('hdg_proxy_pdu').innerHTML = "Proxy PDU - " + (proxy_pdu.length / 2) + " octets";

    if (proxy_pdu.length > (this.mtu * 2)) { // hex chars
        debug("Segmentation required (PDU length > MTU)");
        //app.showMessageRed("Segmentation required ( PDU length > MTU)");
        //alert("Segmentation required ( PDU length > MTU)");
        valid_pdu = false;
        //app.disableButton('btn_submit');

        proxy_pdu = "";
    }

    return proxy_pdu;
}

module.exports = ProxyClient;










/*
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
  
    debug("enc_dst=" + hex_enc_dst);
    debug("enc_transport_pdu=" + hex_enc_transport_pdu);
    debug("NetMIC=" + hex_netmic);
  
    // -----------------------------------------------------
    // 2. Deobfuscate network PDU - ref 3.8.7.3
    // -----------------------------------------------------
    hex_privacy_random = crypto.privacyRandom(hex_enc_dst, hex_enc_transport_pdu, hex_netmic);
    debug("Privacy Random=" + hex_privacy_random);
  
    deobfuscated = crypto.deobfuscate(hex_obfuscated_ctl_ttl_seq_src, this.iv_index, this.netkey, hex_privacy_random, this.hex_privacy_key);
    hex_ctl_ttl_seq_src = deobfuscated.ctl_ttl_seq_src;
  
    // 3.4.6.3 Receiving a Network PDU
    // Upon receiving a message, the node shall check if the value of the NID field value matches one or more known NIDs
    if (hex_pdu_nid != this.hex_nid) {
      debug("unknown nid - discarding");
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
      debug("SRC is not a valid unicast address. 0x0001-0x7FFF allowed. Ref 3.4.2.2");
      return;
    }
  
    ctl_int = (parseInt(hex_pdu_ctl_ttl, 16) & 0x80) >> 7;
    ttl_int = parseInt(hex_pdu_ctl_ttl, 16) & 0x7F;
  
    debug("hex_enc_dst=" + hex_enc_dst);
    debug("hex_enc_transport_pdu=" + hex_enc_transport_pdu);
    debug("hex_netmic=" + hex_netmic);
  
    hex_enc_network_data = hex_enc_dst + hex_enc_transport_pdu + hex_netmic;
    debug("decrypting and verifying network layer: " + hex_enc_network_data + " key: " + this.hex_encryption_key + " nonce: " + hex_nonce);
    result = crypto.decryptAndVerify(hex_encryption_key, hex_enc_network_data, hex_nonce);
    debug("result=" + JSON.stringify(result));
    if (result.status == -1) {
      debug("ERROR: "+result.error.message);
      return;
    }
  
    hex_pdu_dst = result.hex_decrypted.substring(0, 4);
    lower_transport_pdu = result.hex_decrypted.substring(4, result.hex_decrypted.length);
    debug("lower_transport_pdu=" + lower_transport_pdu);
  
    // lower transport layer: 3.5.2.1
    hex_pdu_seg_akf_aid = lower_transport_pdu.substring(0, 2);
    debug("hex_pdu_seg_akf_aid=" + hex_pdu_seg_akf_aid);
    seg_int = (parseInt(hex_pdu_seg_akf_aid, 16) & 0x80) >> 7;
    akf_int = (parseInt(hex_pdu_seg_akf_aid, 16) & 0x40) >> 6;
    aid_int = parseInt(hex_pdu_seg_akf_aid, 16) & 0x3F;
  
    // upper transport: 3.6.2
  
    hex_enc_access_payload_transmic = lower_transport_pdu.substring(2, lower_transport_pdu.length);
    hex_enc_access_payload = hex_enc_access_payload_transmic.substring(0, hex_enc_access_payload_transmic.length - 8);
    hex_transmic = hex_enc_access_payload_transmic.substring(hex_enc_access_payload_transmic.length - 8, hex_enc_access_payload_transmic.length);
    debug("enc_access_payload=" + hex_enc_access_payload);
    debug("transmic=" + hex_transmic);
  
    // access payload: 3.7.3
    // derive Application Nonce (3.8.5.2)
    hex_app_nonce = "0100" + hex_pdu_seq + hex_pdu_src + hex_pdu_dst + this.iv_index;
    debug("application nonce=" + hex_app_nonce);
  
    debug("decrypting and verifying access layer: " + hex_enc_access_payload + hex_transmic + " key: " + hex_appkey + " nonce: " + hex_app_nonce);
    result = crypto.decryptAndVerify(hex_appkey, hex_enc_access_payload + hex_transmic, hex_app_nonce);
    debug("result=" + JSON.stringify(result));
    if (result.status == -1) {
      debug("ERROR: "+result.error.message);
      return;
    }
  
    debug("access payload=" + result.hex_decrypted);
  
    hex_opcode_and_params = utils.getOpcodeAndParams(result.hex_decrypted);
    debug("hex_opcode_and_params=" + JSON.stringify(hex_opcode_and_params));
    hex_opcode = hex_opcode_and_params.opcode;
    hex_params = hex_opcode_and_params.params;
    hex_company_code = hex_opcode_and_params.company_code
  
    debug(" ");
    debug("----------");
    debug("Proxy PDU");
    debug("  SAR=" + utils.intToHex(sar));
    debug("  MESSAGE TYPE=" + utils.intToHex(msgtype));
    debug("  NETWORK PDU");
    debug("    IVI=" + hex_pdu_ivi);
    debug("    NID=" + hex_pdu_nid);
    debug("    CTL=" + utils.intToHex(ctl_int));
    debug("    TTL=" + utils.intToHex(ttl_int));
    debug("    SEQ=" + hex_pdu_seq);
    debug("    SRC=" + hex_pdu_src);
    debug("    DST=" + hex_pdu_dst);
    debug("    Lower Transport PDU");
    debug("      SEG=" + utils.intToHex(seg_int));
    debug("      AKF=" + utils.intToHex(akf_int));
    debug("      AID=" + utils.intToHex(aid_int));
    debug("      Upper Transport PDU");
    debug("        Access Payload");
    debug("          opcode=" + hex_opcode);
    if (hex_company_code != "") {
      debug("          company_code=" + hex_company_code);
    }
    debug("          params=" + hex_params);
    debug("        TransMIC=" + hex_transmic);
    debug("    NetMIC=" + hex_netmic);
    
}
*/


