import struct
import zlib
import os

def create_png(width, height, color=(66, 133, 244)):
    def png_chunk(chunk_type, data):
        chunk = chunk_type + data
        crc = zlib.crc32(chunk) & 0xffffffff
        return struct.pack('>I', len(data)) + chunk + struct.pack('>I', crc)
    
    signature = b'\x89PNG\r\n\x1a\n'
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    ihdr = png_chunk(b'IHDR', ihdr_data)
    
    raw_data = b''
    for y in range(height):
        raw_data += b'\x00'
        for x in range(width):
            cx, cy = width // 2, height // 2
            r = min(width, height) // 2 - 2
            dist = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            if dist < r:
                raw_data += bytes(color + (255,))
            else:
                raw_data += bytes([0, 0, 0, 0])
    
    compressed = zlib.compress(raw_data, 9)
    idat = png_chunk(b'IDAT', compressed)
    iend = png_chunk(b'IEND', b'')
    
    return signature + ihdr + idat + iend

os.makedirs('public/icons', exist_ok=True)

for size, filename in [(16, 'icon16.png'), (48, 'icon48.png'), (128, 'icon128.png')]:
    with open(f'public/icons/{filename}', 'wb') as f:
        f.write(create_png(size, size))
    print(f'Created {filename}')

print('Done!')
