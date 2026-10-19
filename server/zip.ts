// ZIP STORE format: no native binaries, preserves arbitrary binary assets.
export function createZip(files: Record<string, string | Buffer>): Buffer {
  const table = new Uint32Array(256);
  for (let n=0;n<256;n++) { let c=n; for(let k=0;k<8;k++) c=(c&1)?0xedb88320^(c>>>1):c>>>1; table[n]=c>>>0; }
  const crc32 = (bytes: Buffer) => { let crc=0xffffffff; for(const b of bytes) crc=table[(crc^b)&255]!^(crc>>>8); return (crc^0xffffffff)>>>0; };
  const chunks: Buffer[] = []; const directory: Buffer[] = []; let offset=0;
  for(const [name,value] of Object.entries(files)) {
    if (name.startsWith('/') || name.split('/').includes('..')) throw new Error('Invalid archive path');
    const filename=Buffer.from(name); const data=Buffer.isBuffer(value)?value:Buffer.from(value); const crc=crc32(data);
    const local=Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20,4); local.writeUInt16LE(0x0800,6); local.writeUInt32LE(crc,14); local.writeUInt32LE(data.length,18); local.writeUInt32LE(data.length,22); local.writeUInt16LE(filename.length,26);
    chunks.push(local,filename,data);
    const central=Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20,4); central.writeUInt16LE(20,6); central.writeUInt16LE(0x0800,8); central.writeUInt32LE(crc,16); central.writeUInt32LE(data.length,20); central.writeUInt32LE(data.length,24); central.writeUInt16LE(filename.length,28); central.writeUInt32LE(offset,42); directory.push(central,filename);
    offset+=local.length+filename.length+data.length;
  }
  const central=Buffer.concat(directory); const end=Buffer.alloc(22); const count=Object.keys(files).length; end.writeUInt32LE(0x06054b50); end.writeUInt16LE(count,8); end.writeUInt16LE(count,10); end.writeUInt32LE(central.length,12); end.writeUInt32LE(offset,16);
  return Buffer.concat([...chunks,central,end]);
}
