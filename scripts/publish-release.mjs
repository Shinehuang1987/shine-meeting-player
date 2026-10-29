import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const {GH_TOKEN,REPO,COMMIT}=process.env;
if(!GH_TOKEN||!REPO||!COMMIT)throw new Error('Missing GitHub Actions environment.');
const manifest=JSON.parse(await fs.readFile('manifest.json','utf8'));
const version=manifest.version;
if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error('Expected plain semantic version.');
if(manifest.isDesktopOnly!==false)throw new Error('This beta must support mobile.');
const base=`https://api.github.com/repos/${REPO}`;
const headers={Authorization:`Bearer ${GH_TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
async function api(url,method='GET',body){
 const response=await fetch(url,{method,headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 if(response.status===404)return null;
 if(!response.ok)throw new Error(`GitHub ${method}: HTTP ${response.status}`);
 return response.json();
}
let release=await api(`${base}/releases/tags/${version}`);
if(release){
 const ref=await api(`${base}/git/ref/tags/${version}`);
 if(ref?.object?.sha!==COMMIT)throw new Error('This version already exists at a different commit. Bump manifest.json before publishing an update.');
}else{
 release=await api(`${base}/releases`,'POST',{
  tag_name:version,name:version,target_commitish:COMMIT,prerelease:true,
  body:'安卓测试版：库内音频选择、原笔记同步高亮、3 秒跳转、字幕校准、选词摘录按钮与命令。桌面保留外部文件选择。仅发布通用代码，不包含会议或音频。模拟移动环境测试通过，安卓实机及锁屏/后台播放仍待验证。BRAT 添加本仓库即可安装。'
 });
}
for(const name of ['manifest.json','main.js','styles.css']){
 const bytes=await fs.readFile(name),hash='sha256:'+createHash('sha256').update(bytes).digest('hex');
 const existing=release.assets.find(asset=>asset.name===name);
 if(existing){if(existing.size!==bytes.length||existing.digest&&existing.digest!==hash)throw new Error(`Existing asset differs: ${name}`);console.log(`Verified existing ${name}`);continue;}
 const response=await fetch(`${release.upload_url.split('{')[0]}?name=${encodeURIComponent(name)}`,{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream'},body:bytes});
 if(!response.ok)throw new Error(`Upload ${name}: HTTP ${response.status}`);
 const asset=await response.json();
 if(asset.size!==bytes.length||asset.digest&&asset.digest!==hash)throw new Error(`Uploaded asset mismatch: ${name}`);
 console.log(`Verified ${name}: ${bytes.length} bytes, ${hash}`);
}
console.log(`BRAT release ready: ${release.html_url}`);
