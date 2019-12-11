let filter = function(bits) {
    let mask = 1;
    let i;
    for(i = 0; i < (bits - 1); i++) {
        mask = (mask << 1) + 0x01;
    }
    return mask;
}

let u2s = function(val, nBits) {
    let si = val;
    if(si >= (1 << (nBits - 1))) {
        let mask = filter(nBits);
        si = val - mask - 1;
        //si = si & mask;
    } 
    return si;
}

let s2u = function(val, nBits) {
    let ui = val;
    if(val < 0) {
        let mask = filter(nBits);
        ui = val + mask + 1;
        //ui = ui & mask;

    }
    return ui;
}

let deserialize = function(template, buf) {
    let o = {};

    let currentBit = 0;
    let i; // Needed for mjs
    for(i = 0; i < template.length; i = i + 3) {
        if((template[i + 1] === "sint") || (template[i + 1] === "uint")) {
            let val = 0;

            let nBits = template[i + 2];
            let firstBit = currentBit;
            let lastBit = currentBit + nBits - 1;
            let firstByte = (firstBit / 8) >> 0;
            let lastByte = (lastBit / 8) >> 0;

            let j;
            for(j = 0; j < (lastByte - firstByte + 1); j++) {
                val = val + (buf[firstByte + j] << (8 * j));
            }
            //let rShift =  (8 - (firstBit % 8) - 1);
            val = val >> (firstBit % 8);
            val = filter(nBits) & val;

            if(template[i + 1] === "sint") {
                val = u2s(val, nBits);
            }

            currentBit = currentBit + nBits;

            o[template[i]] = val;
        }
        else if(template[i + 1] === "str") {
            let val = "";
            let j;
            for(j = 0; j < (template[i + 2] / 8); j++) {
                val = val + String.fromCharCode(buf[currentBit / 8]); // MJS chr??
                currentBit = currentBit + 8;
            }
            o[template[i]] = val;
        }
    }
    return o;
}

let serialize = function(template, msg) {
    let buf = [];
    let currentBit = 0;
    let i; // Needed for mjs
    for(i = 0; i < template.length; i = i + 3) {
        
        if((template[i + 1] === "sint") || (template[i + 1] === "uint")) {
            let val = msg[template[i]];
            let nBits = template[i + 2];

            if(template[i + 1] === "sint") {
                val = s2u(val, nBits);
            }

            let firstBit = currentBit;
            let offsetBit = firstBit % 8;

            val = val << offsetBit;
            nBits = nBits + offsetBit;

            let lastBit = currentBit + nBits - 1;
            let firstByte = (firstBit / 8) >> 0;
            let lastByte = (lastBit / 8) >> 0;

            let j;
            for(j = 0; j < (lastByte - firstByte + 1); j++) {
                if(!buf[firstByte + j]) {
                    buf[firstByte + j] = (val >> (8 * j)) & 0x00FF;
                }
                else {
                    buf[firstByte + j] = buf[firstByte + j] + ((val >> (8 * j)) & 0x00FF);
                }
            }

            currentBit = currentBit + template[i + 2];
        }
        else if(template[i + 1] === "str") {
            let val = msg[template[i]];
            let nBits = template[i + 2];

            let firstBit = currentBit;
            let lastBit = currentBit + nBits - 1;
            let firstByte = (firstBit / 8) >> 0;
            let lastByte = (lastBit / 8) >> 0;

            let j;
            for(j = 0; j < (lastByte - firstByte + 1); j++) {
                buf[j + firstByte] = val.charAt(j).charCodeAt();
            }
            currentBit = currentBit + nBits;
        }
    }
    return buf;
}

let tMsg = [
    "a", "uint", 4,
    "b", "uint", 12,
    "c", "uint", 16,
];
let buf = [ 0x76, 0x98, 0x34, 0x12];
console.log(buf);
let obj = deserialize(tMsg, buf);
console.log(obj);
let buf2 = serialize(tMsg, obj);
console.log(buf2);

module.exports = {"serialize": serialize, "deserialize": deserialize};