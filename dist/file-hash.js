import {sha256} from './vendor/sha256.mjs';

// Read bounded chunks rather than copying a large book into a single buffer.
export async function hashFile(file) {
  const hash=sha256.create(),chunkSize=1048576;
  for(let offset=0;offset<file.size;offset+=chunkSize)
    hash.update(new Uint8Array(await file.slice(offset,offset+chunkSize).arrayBuffer()));
  return Array.from(hash.digest(),byte=>byte.toString(16).padStart(2,'0')).join('');
}
