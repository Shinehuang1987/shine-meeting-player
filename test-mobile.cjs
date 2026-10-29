const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
class TFile{constructor(path,extension='md'){this.path=path;this.extension=extension;}}
class Plugin{async loadData(){return {};}registerEvent(){}addCommand(cmd){this.commands.push(cmd);}registerObsidianProtocolHandler(){}}
let picker;
class Suggest{constructor(app){picker=this;this.app=app;}setPlaceholder(){}open(){}}
const platform={isMobile:true};
const commands=[];
const box={module:{exports:{}},require:n=>{assert.equal(n,'obsidian','Mobile must never load Node/Electron: '+n);return {Plugin,Modal:class{},FuzzySuggestModal:Suggest,TFile,Platform:platform,normalizePath:p=>p,Notice:class{}};}};
vm.runInNewContext(fs.readFileSync(__dirname+'/main.js','utf8'),box);
const Class=box.module.exports;
const {parse,activeAt,cleanSource,externalSource}=Class._test;
assert.equal(cleanSource('"Attachement/会议音频/a.mp3"'),'Attachement/会议音频/a.mp3');
assert.equal(cleanSource('![[Attachement/a.mp3|sound]]'),'Attachement/a.mp3');
assert.ok(externalSource('D:/meeting.mp3'));assert.ok(externalSource('/storage/emulated/0/a.mp3'));
assert.equal(externalSource('Attachement/a.mp3'),false);
const rows=parse('[00:01-00:03] first\n[00:05-00:08] second');
assert.equal(activeAt(rows,2),0);assert.equal(activeAt(rows,4),-1);
(async()=>{
 const p=new Class();p.commands=commands;const audio=new TFile('Attachement/会议音频/a.mp3','mp3');let fields={};
 p.app={workspace:{on:()=>({})},metadataCache:{getFirstLinkpathDest:()=>audio,getFileCache:()=>({frontmatter:fields})},vault:{getFiles:()=>[audio,new TFile('notes.md')],getResourcePath:f=>'mock-vault://'+f.path,getAbstractFileByPath:()=>null},fileManager:{processFrontMatter:async(f,fn)=>fn(fields)}};
 await p.onload();p.saveData=async()=>{};p.open=async()=>{};
 const media=await p.loadMedia('Attachement/会议音频/a.mp3',new TFile('source.md'));
 assert.equal(media.url,'mock-vault://Attachement/会议音频/a.mp3');assert.equal(media.objectURL,false);
 await assert.rejects(p.loadMedia('D:/a.mp3',new TFile('source.md')),/电脑外部路径/);
 p.choose(new TFile('source.md'));assert.equal(picker.getItems().length,1);await picker.done(audio);assert.equal(fields.audio,audio.path);
 const editor={getSelection:()=> 'one word\nand another paragraph',getCursor:()=>({line:1}),getValue:()=> '[00:01] first\n[00:05] second'};
 const capture=p.captureSelection(new TFile('source.md'),editor);assert.equal(capture.row.start,5);assert.equal(capture.text,'one word\nand another paragraph');
 let received;p.excerpt=(...args)=>received=args;commands.find(c=>c.id==='excerpt-selection').editorCallback(editor,{file:new TFile('source.md')});assert.equal(received[2],capture.text);
 assert.ok(commands.some(c=>c.id==='open-player'));assert.ok(commands.some(c=>c.id==='play-from-cursor'));
 console.log('PASS: mobile loads with Node/Electron unavailable; vault media URL; absolute-path rejection; audio picker; selection command; timestamp boundaries.');
})().catch(e=>{console.error(e);process.exitCode=1;});

