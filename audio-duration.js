import { spawn } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';

// Decode in memory. A client-supplied duration or container timestamp is not a quota proof.
export function audioDuration(buffer, maximum = 180) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ['-hide_banner','-loglevel','error','-nostdin','-i','pipe:0',
      '-vn','-t',String(maximum + 1),'-ac','1','-ar','16000','-f','s16le','pipe:1'],
      {windowsHide:true, stdio:['pipe','pipe','ignore']});
    let bytes = 0, timedOut = false;
    const timer = setTimeout(() => {timedOut=true;child.kill();},5000);
    child.stdout.on('data', chunk => {bytes += chunk.length;});
    child.stdin.on('error', () => {});
    child.on('error', error => {clearTimeout(timer);reject(error);});
    child.on('close', code => {
      clearTimeout(timer);
      const seconds = bytes / 32000;
      if (timedOut || code !== 0 || !seconds) return reject(Object.assign(new Error('Audio illisible. Réenregistrez votre question.'),{status:400,clientSafe:true}));
      if (seconds > maximum) return reject(Object.assign(new Error(`Audio trop long : ${maximum} secondes maximum par envoi.`),{status:413,clientSafe:true}));
      resolve(Math.ceil(seconds * 1000) / 1000);
    });
    child.stdin.end(buffer);
  });
}
