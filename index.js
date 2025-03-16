import express from "express"
import cors from "cors"
import http from "http"
import { Server } from "socket.io"
import dotenv from "dotenv"
import fs from "fs"
import { Readable } from "stream"
import axios from "axios"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"
import path from "path"

dotenv.config();

const s3 = new S3Client({
    credentials: {
        accessKeyId: process.env.ACCESS_KEY,
        secretAccessKey: process.env.SECRET_KEY
    },
    region: process.env.BUCKET_REGION
})

const app = express();

const server = http.createServer(app);

app.use(cors())

const io = new Server(server, {
    cors: {
        origin: process.env.ELECTRON_HOST,
        methods: ["GET", "POST"]
    }
})

let recordedChunks = [];

io.on("connection", (socket) => {
    console.log("🟢 socket is connected");

    socket.on("video-chunks", async (data) => {
        console.log("🟢 video chunk is sent", data);
        const uploadDir = path.join(__dirname, "temp_upload");
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        const writeStreams = fs.createWriteStream("temp_upload/" + data.filename)
        recordedChunks.push(data.chunks)
        const videoBlob = new Blob(recordedChunks, {
            type: "video/webm; codecs=vp9"
        })
        const buffer = Buffer.from(await videoBlob.arrayBuffer());
        const readStream = Readable.from(buffer);
        readStream.pipe(writeStreams).on("finish", () => {
            console.log("🟢 chunk saved")
        })
    })

    socket.on("process-video", async (data) => {
        console.log("🟢 processing video");

        recordedChunks = [];
        fs.readFile("temp_upload/" + data.filename, async (err, file) => {
            const processing = await axios.post(`${process.env.NEXT_API_HOST}recording/${data.userId}/processing`, {
                filename: data.filename
            })

            //console.log("processing", processing);

            if (processing.data.status !== 200) {
                return console.log("🔴 something went wrong")
            }

            const key = data.filename
            const Bucket = process.env.BUCKET_NAME
            const ContentType = "video/webm"
            const command = new PutObjectCommand({
                Key: key,
                Bucket,
                ContentType,
                Body: file
            })

            const fileStatus = await s3.send(command);

            if (fileStatus['$metadata'].httpStatusCode === 200) {
                console.log("🟢 video uploaded to aws");
            }

            const stopprocessing = await axios.post(`${process.env.NEXT_API_HOST}recording/${processing.data.videoId}/complete`, {
                filename: data.filename
            })

            if (stopprocessing.data.status !== 200) {
                console.log("🔴 something went wrong in processing.");
            }
            else {
                fs.unlink("temp_upload/" + data.filename, (err) => {
                    if (!err) {
                        console.log(data.filename + " " + "deleted successfully.");
                    }

                })
            }
        })

    })

    socket.on("disconnect", async (data) => {
        console.log("🟢 sokcet is disconnected", data)
    })
})

server.listen(5000, () => {
    console.log("🟢 listening on port 5000");
})