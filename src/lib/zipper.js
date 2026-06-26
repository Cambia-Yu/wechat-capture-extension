/**
 * 轻量级 ZIP 创建器（Store 模式，无压缩）
 * 支持在 Service Worker 中运行
 */

const Zipper = {
  /**
   * 创建 ZIP 文件并返回 Blob
   * @param {Array<{name: string, data: Uint8Array|ArrayBuffer|Blob}>} files
   * @returns {Promise<Blob>}
   */
  async createZip(files) {
    const encoder = new TextEncoder();
    const localHeaders = [];
    const centralHeaders = [];
    let offset = 0;
    const fileDataBuffers = [];
    
    for (const file of files) {
      const data = await this._toUint8Array(file.data);
      const nameBytes = encoder.encode(file.name);
      
      // Generate CRC-32 (simple approximation)
      const crc = this._crc32(data);
      
      // Local file header
      const localHeader = this._buildLocalHeader(nameBytes, data.length, crc);
      localHeaders.push(localHeader);
      
      // File data offset tracking
      const headerSize = localHeader.length + data.length;
      fileDataBuffers.push({
        header: localHeader,
        data: data
      });
      
      // Central directory header
      const centralHeader = this._buildCentralHeader(nameBytes, data.length, crc, offset);
      centralHeaders.push(centralHeader);
      
      offset += headerSize;
    }
    
    // Calculate total size
    const totalLocalSize = fileDataBuffers.reduce(
      (sum, f) => sum + f.header.length + f.data.length, 0
    );
    const totalCentralSize = centralHeaders.reduce((sum, h) => sum + h.length, 0);
    const eocd = this._buildEOCD(files.length, totalCentralSize, totalLocalSize);
    
    // Concatenate all parts
    const totalSize = totalLocalSize + totalCentralSize + eocd.length;
    const zipBuffer = new Uint8Array(totalSize);
    let pos = 0;
    
    for (const f of fileDataBuffers) {
      zipBuffer.set(f.header, pos); pos += f.header.length;
      zipBuffer.set(f.data, pos); pos += f.data.length;
    }
    
    for (const h of centralHeaders) {
      zipBuffer.set(h, pos); pos += h.length;
    }
    
    zipBuffer.set(eocd, pos);
    
    return new Blob([zipBuffer], { type: 'application/zip' });
  },

  /**
   * 构建本地文件头
   */
  _buildLocalHeader(nameBytes, dataSize, crc) {
    const buf = new ArrayBuffer(30 + nameBytes.length);
    const view = new DataView(buf);
    let pos = 0;
    
    // Local file header signature
    view.setUint32(pos, 0x04034b50, true); pos += 4;
    // Version needed
    view.setUint16(pos, 20, true); pos += 2;
    // General purpose bit flag
    view.setUint16(pos, 0, true); pos += 2;
    // Compression method (0 = store)
    view.setUint16(pos, 0, true); pos += 2;
    // Last mod time
    view.setUint16(pos, 0, true); pos += 2;
    // Last mod date
    view.setUint16(pos, 0, true); pos += 2;
    // CRC-32
    view.setUint32(pos, crc, true); pos += 4;
    // Compressed size
    view.setUint32(pos, dataSize, true); pos += 4;
    // Uncompressed size
    view.setUint32(pos, dataSize, true); pos += 4;
    // File name length
    view.setUint16(pos, nameBytes.length, true); pos += 2;
    // Extra field length
    view.setUint16(pos, 0, true); pos += 2;
    
    // File name
    const result = new Uint8Array(buf);
    result.set(nameBytes, pos);
    
    return result;
  },

  /**
   * 构建中央目录头
   */
  _buildCentralHeader(nameBytes, dataSize, crc, localOffset) {
    const buf = new ArrayBuffer(46 + nameBytes.length);
    const view = new DataView(buf);
    let pos = 0;
    
    view.setUint32(pos, 0x02014b50, true); pos += 4;
    view.setUint16(pos, 20, true); pos += 2; // version made by
    view.setUint16(pos, 20, true); pos += 2; // version needed
    view.setUint16(pos, 0, true); pos += 2;  // flags
    view.setUint16(pos, 0, true); pos += 2;  // compression
    view.setUint16(pos, 0, true); pos += 2;  // mod time
    view.setUint16(pos, 0, true); pos += 2;  // mod date
    view.setUint32(pos, crc, true); pos += 4;
    view.setUint32(pos, dataSize, true); pos += 4; // compressed
    view.setUint32(pos, dataSize, true); pos += 4; // uncompressed
    view.setUint16(pos, nameBytes.length, true); pos += 2;
    view.setUint16(pos, 0, true); pos += 2;  // extra
    view.setUint16(pos, 0, true); pos += 2;  // comment
    view.setUint16(pos, 0, true); pos += 2;  // disk start
    view.setUint16(pos, 0, true); pos += 2;  // internal attrs
    view.setUint32(pos, 0, true); pos += 4;  // external attrs
    view.setUint32(pos, localOffset, true); pos += 4;
    
    const result = new Uint8Array(buf);
    result.set(nameBytes, pos);
    
    return result;
  },

  /**
   * 构建 EOCD 记录
   */
  _buildEOCD(fileCount, centralSize, centralOffset) {
    const buf = new ArrayBuffer(22);
    const view = new DataView(buf);
    
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(4, 0, true);   // disk number
    view.setUint16(6, 0, true);   // disk with central dir
    view.setUint16(8, fileCount, true);
    view.setUint16(10, fileCount, true);
    view.setUint32(12, centralSize, true);
    view.setUint32(16, centralOffset, true);
    view.setUint16(20, 0, true);  // comment length
    
    return new Uint8Array(buf);
  },

  /**
   * CRC-32 计算
   */
  _crc32(data) {
    if (this._crcTable === undefined) {
      this._crcTable = [];
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
          c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        this._crcTable[i] = c;
      }
    }
    
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
      crc = this._crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  },

  /**
   * 将各种类型转换为 Uint8Array
   */
  async _toUint8Array(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (data instanceof Blob) {
      const buf = await data.arrayBuffer();
      return new Uint8Array(buf);
    }
    // String
    const encoder = new TextEncoder();
    return encoder.encode(String(data));
  }
};

export { Zipper };
