var fs = require('fs')
const ytdl = require('ytdl-core');
const chalk = require('chalk');
const sanitize = require("sanitize-filename");
var MultiProgress = require('multi-progress');
const async = require('async');
const flatten = require('./utils')
const ytfps = require('ytfps');

videos = flatten(require('./videos.json'))

const baseDir = "./videos/"
const MAX_CONCURRENT_TASKS = Number(process.env.MAX_CONCURRENT_TASKS ?? 5);

var multiBar = new MultiProgress()

console.log(chalk.white.bgRed.bold('Multi video downloader'))

if(Object.keys(videos).length === 0) {
    chalk.Red.bold('Video list empty')
    process.exit()
}

function sanitizeText(str){
    return sanitize(str)
            .replace(/\s\s+/g, " ")
            .replace(/\s/g, "-")
}

let downloadProgress = multiBar.newBar(
    ":total Videos [:bar] :percent",{
        complete: '=',
        incomplete: ' ',
        width: 20,
        total: Object.keys(videos)
                .reduce((acc, curr) => [...acc, ...videos[curr]],[])
                .length,
    }
)

function mapPlaylistToVideos(playlists){
    videos.playlists = playlists.map(
        (playlistOBJ) => ({
            [sanitizeText(playlistOBJ.title)] : playlistOBJ
                                    .videos
                                    .map((video) => video.id)
        })
    ).reduce((acc,curr) => ({...acc, ...curr}), {});

    videos = flatten(videos)
}

function createDirs(){
    Object.keys(videos).forEach(
        (path) => {
            fs.mkdirSync(baseDir+path, { recursive: true })
        }
    )
}

function downloadVideo(path, url, resolve = () => {}) {
    // DOCS: https://www.npmjs.com/package/ytdl-core#ytdlchooseformatformats-options
    const name_max_length = 20;
    let currentVid = ytdl(url, {
        quality: "highest",
        filter: (format) => format.container === 'mp4'
    })

    ytdl.getInfo(url).then((vidInfo)=> {
        let vidProgressBar = undefined;
        let chunkLength = 0;
        let filename = sanitizeText(vidInfo.videoDetails.title)+".mp4";
        currentVid.pipe(fs.createWriteStream(baseDir+path+"/"+filename))

        currentVid.on("progress",function(_chunkLength,chunksDownloaded, totalChunks){
            if(vidProgressBar== undefined) {
                vidProgressBar = multiBar.newBar(
                    `${filename.slice(0,name_max_length)} [:bar] :rate/bps :percent :etas`, 
                    { 
                        complete: '=',
                        incomplete: ' ',
                        width: 20,
                        total: totalChunks,
                    }
                );
            }
            
            vidProgressBar.tick(chunksDownloaded - chunkLength)
            chunkLength = chunksDownloaded;
            if(chunkLength == totalChunks){
                downloadProgress.tick();
                resolve();
            }
        })
    })
}

async function main(){
    downloadProgress.tick(0);

    if(videos.playlists && videos.playlists.length > 0){
        mapPlaylistToVideos(await Promise.all(
            videos.playlists.map(
                (playlistURL) => ytfps(playlistURL)
            )
        ));
    }

    createDirs();

    const queue = async.queue(async ({url,path}, callback = (_err, _r) => {}) => {
        await new Promise(
            (resolve, _reject) => {
                downloadVideo(path, url, resolve)
            }
        )
        callback();
    }, MAX_CONCURRENT_TASKS);

    queue.error(function (error, url){
        console.log(`An error occurred while processing task ${url}`);
        console.error(error);
    });

    Object.keys(videos).forEach(
        (path) => {
            videos[path].forEach(
                (url) => queue.push({path,url})
            )
        }
    )

    queue.drain(() => {
        console.log('Successfully processed all videos');
    })
}

main();