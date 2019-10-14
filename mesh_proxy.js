var bleno = require('bleno');
var utils = require('./utils.js');
var crypto = require('./crypto.js');
var colors = require('colors');

// usually provided via provisioning and configuration of the node
var hex_iv_index = "12345677";
var hex_netkey = "7dd7364cd842ad18c17c2b820c84c3d6";
var hex_appkey = "63964771734fbd76e3b40519d1d94a48";

hex_encryption_key = ""; // derived from NetKey using k2
hex_privacy_key = "";    // derived from NetKey using k2
hex_nid = "";            // derived from NetKey using k2
hex_network_id = "";     // derived from NetKey using k3

// advertising fields
var flags = [0x02, 0x01, 0x06];
var complete_list_of_16_bit_uuids = [0x03, 0x03, 0x28, 0x18];
    // Service Data:
    //   Len, Type and UUID: 0x0C, 0x16, 0x28, 0x18
    //   Identification Type: 0x00
    //   Network ID (generated from netkey with K3) : 0x3e, 0xca, 0xff, 0x67, 0x2f, 0x67, 0x33, 0x70
var service_data_len_type_uuid = [0x0C, 0x16, 0x28, 0x18];
var identification_type = [0x00];

var advertising_payload = [];

initialise();

function initialise() {
  crypto.init();
  k2_material = crypto.k2(hex_netkey, "00");
  hex_encryption_key = k2_material.encryption_key;
  hex_privacy_key = k2_material.privacy_key;
  hex_nid = k2_material.NID;
  network_id = crypto.k3(hex_netkey);

  advertising_payload = advertising_payload.concat(flags);
  advertising_payload = advertising_payload.concat(complete_list_of_16_bit_uuids);
  advertising_payload = advertising_payload.concat(service_data_len_type_uuid);
  advertising_payload = advertising_payload.concat(identification_type);
  advertising_payload = advertising_payload.concat(utils.hexStringToArray(network_id));

}

bleno.on('stateChange', function (state) {
  console.log('on -> stateChange: ' + state);

  if (state === 'poweredOn') {
    const scanData = Buffer.from([]);
    bleno.startAdvertisingWithEIRData(Buffer.from(advertising_payload));
  } else {
    bleno.stopAdvertising();
  }
});

bleno.on('accept', function (clientAddress) {
  console.log('on -> accept, client: ' + clientAddress);
});

bleno.on('disconnect', function (clientAddress) {
  console.log("Disconnected from address: " + clientAddress);
});

bleno.on('advertisingStart', function (error) {
  console.log('on -> advertisingStart: ' + (error ? 'error ' + error : 'success'));

  if (!error) {
    bleno.setServices([
      // mesh proxy service
      new bleno.PrimaryService({
        uuid: '1828',
        characteristics: [
          // Data In
          new bleno.Characteristic({
            value: null,
            uuid: '2ADD',
            properties: ['writeWithoutResponse'],
            onWriteRequest: function (data, offset, withoutResponse, callback) {
              this.value = data;
              console.log('Write request:');
              var octets = new Uint8Array(data);
              console.log(utils.u8AToHexString(octets).toUpperCase());
              logAndValidatePdu(octets);
              callback(this.RESULT_SUCCESS);
            }
          }),
          // Data Out
          new bleno.Characteristic({
            value: null,
            uuid: '2ADE',
            properties: ['notify'],
            onSubscribe: function (maxValueSize, updateValueCallback) {
              console.log("subscribed to Data Out notifications");
              console.log(colors.red("No notifications will be generated however!"));
            },

            // If the client unsubscribes, we stop broadcasting the message
            onUnsubscribe: function () {
              console.log("unsubscribed from Data Out notifications");
              clearInterval(this.intervalId);
            }
          })

        ]
      }),
    ]);
  }
});

bleno.on('servicesSet', function (error) {
  console.log('on -> servicesSet: ' + (error ? 'error ' + error : 'success'));
});

function logAndValidatePdu(octets) {

  // length validation
  if (octets.length < 1) {
    console.log(colors.red("Error: No data received"));
    return;
  }

  // -----------------------------------------------------
  // 1. Extract proxy PDU fields : SAR, msgtype, data
  // -----------------------------------------------------
  sar_msgtype = octets.subarray(0, 1);
  console.log("sar_msgtype="+sar_msgtype);
  sar = (sar_msgtype & 0xC0) >> 6;
  if (sar < 0 || sar > 3) {
    console.log(colors.red("SAR contains invalid value. 0-3 allowed. Ref Table 6.2"));
    return;
  }
  
  msgtype = sar_msgtype & 0x3F;
  if (msgtype < 0 || msgtype > 3) {
    console.log(colors.red("Message Type contains invalid value. 0x00-0x03 allowed. Ref Table 6.3"));
    return;
  }

  // See table 3.7 for min length of network PDU and 6.1 for proxy PDU length
  if (octets.length < 15) {
    console.log(colors.red("PDU is too short (min 15 bytes) - " + octets.length+" bytes received"));
    return;
  }

  network_pdu = null;
  network_pdu = octets.subarray(1, octets.length);

  console.log("Proxy PDU: SAR=" + utils.intToHex(sar) + " MSGTYPE=" + utils.intToHex(msgtype) + " NETWORK PDU=" + utils.u8AToHexString(network_pdu));

  // demarshall obfuscated network pdu
  pdu_ivi = network_pdu.subarray(0, 1) & 0x80;
  pdu_nid = network_pdu.subarray(0, 1) & 0x7F;
  obfuscated_ctl_ttl_seq_src = network_pdu.subarray(1, 7);
  enc_dst = network_pdu.subarray(7, 9);
  enc_transport_pdu = network_pdu.subarray(9, network_pdu.length - 4);
  netmic = network_pdu.subarray(network_pdu.length - 4, network_pdu.length);

  hex_pdu_ivi = utils.intToHex(pdu_ivi);
  hex_pdu_nid = utils.intToHex(pdu_nid);
  hex_obfuscated_ctl_ttl_seq_src = utils.u8AToHexString(obfuscated_ctl_ttl_seq_src);
  hex_enc_dst = utils.u8AToHexString(enc_dst);
  hex_enc_transport_pdu = utils.u8AToHexString(enc_transport_pdu);
  hex_netmic = utils.intToHex(netmic);

  console.log("enc_dst=" + hex_enc_dst);
  console.log("enc_transport_pdu=" + hex_enc_transport_pdu);
  console.log("NetMIC=" + hex_netmic);

  // -----------------------------------------------------
  // 2. Deobfuscate network PDU - ref 3.8.7.3
  // -----------------------------------------------------
  hex_privacy_random = crypto.privacyRandom(hex_enc_dst, hex_enc_transport_pdu, hex_netmic);
  console.log("Privacy Random=" + hex_privacy_random);

  deobfuscated = crypto.deobfuscate(hex_obfuscated_ctl_ttl_seq_src, hex_iv_index, hex_netkey, hex_privacy_random, hex_privacy_key);
  hex_ctl_ttl_seq_src = deobfuscated.ctl_ttl_seq_src;

  // 3.4.6.3 Receiving a Network PDU
  // Upon receiving a message, the node shall check if the value of the NID field value matches one or more known NIDs
  if (hex_pdu_nid != hex_nid) {
    console.log(colors.red("unknown nid - discarding"));
    return;
  }

  hex_enc_dst = utils.bytesToHex(enc_dst);
  hex_enc_transport_pdu = utils.bytesToHex(enc_transport_pdu);
  hex_netmic = utils.bytesToHex(netmic);


  // ref 3.8.7.2 Network layer authentication and encryption

  // -----------------------------------------------------
  // 3. Decrypt and verify network PDU - ref 3.8.5.1
  // -----------------------------------------------------

  hex_nonce = "00" + hex_ctl_ttl_seq_src + "0000" + hex_iv_index;
  hex_pdu_ctl_ttl = hex_ctl_ttl_seq_src.substring(0, 2);

  hex_pdu_seq = hex_ctl_ttl_seq_src.substring(2, 8);
  // NB: SEQ should be unique for each PDU received. We don't enforce this rule here to allow for testing with the same values repeatedly.

  hex_pdu_src = hex_ctl_ttl_seq_src.substring(8, 12);
  // validate SRC
  src_bytes = utils.hexToBytes(hex_pdu_src);
  src_value = src_bytes[0] + (src_bytes[1] << 8);
  if (src_value < 0x0001 || src_value > 0x7FFF) {
    console.log(colors.red("SRC is not a valid unicast address. 0x0001-0x7FFF allowed. Ref 3.4.2.2"));
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
  hex_app_nonce = "0100" + hex_pdu_seq + hex_pdu_src + hex_pdu_dst + hex_iv_index;
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
  console.log(colors.yellow.bold("Proxy PDU"));
  console.log(colors.green("  SAR=" + utils.intToHex(sar)));
  console.log(colors.green("  MESSAGE TYPE=" + utils.intToHex(msgtype)));
  console.log(colors.yellow.bold("  NETWORK PDU"));
  console.log(colors.green("    IVI=" + hex_pdu_ivi));
  console.log(colors.green("    NID=" + hex_pdu_nid));
  console.log(colors.green("    CTL=" + utils.intToHex(ctl_int)));
  console.log(colors.green("    TTL=" + utils.intToHex(ttl_int)));
  console.log(colors.green("    SEQ=" + hex_pdu_seq));
  console.log(colors.green("    SRC=" + hex_pdu_src));
  console.log(colors.green("    DST=" + hex_pdu_dst));
  console.log(colors.yellow.bold("    Lower Transport PDU"));
  console.log(colors.green("      SEG=" + utils.intToHex(seg_int)));
  console.log(colors.green("      AKF=" + utils.intToHex(akf_int)));
  console.log(colors.green("      AID=" + utils.intToHex(aid_int)));
  console.log(colors.yellow.bold("      Upper Transport PDU"));
  console.log(colors.yellow.bold("        Access Payload"));
  console.log(colors.green("          opcode=" + hex_opcode));
  if (hex_company_code != "") {
    console.log(colors.green("          company_code=" + hex_company_code));
  }
  console.log(colors.green("          params=" + hex_params));
  console.log(colors.green("        TransMIC=" + hex_transmic));
  console.log(colors.green("    NetMIC=" + hex_netmic));
  
}