import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";

export function createMinioStorageFromEnv() {
  const endpoint = process.env.MINIO_ENDPOINT;
  const region = process.env.MINIO_REGION;
  const accessKeyId = process.env.MINIO_ACCESS_KEY;
  const secretAccessKey = process.env.MINIO_SECRET_KEY;
  const bucket = process.env.MINIO_BUCKET;
  const forcePathStyle = String(process.env.MINIO_FORCE_PATH_STYLE || "true") === "true";

  if (!endpoint || !region || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      "Missing MinIO env vars. Required: MINIO_ENDPOINT, MINIO_REGION, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, MINIO_BUCKET"
    );
  }

  const client = new S3Client({
    endpoint,
    region,
    forcePathStyle,
    credentials: { accessKeyId, secretAccessKey }
  });

  return {
    provider: "minio",
    async assertReady() {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    },
    async putObject({ key, body, contentType }) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType
        })
      );
      return { objectKey: key, storageProvider: "minio" };
    },
    async getObjectStream({ key, range }) {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        Range: range || undefined
      });
      const out = await client.send(command);
      return {
        body: out.Body,
        contentType: out.ContentType,
        contentLength: out.ContentLength,
        contentRange: out.ContentRange,
        acceptRanges: out.AcceptRanges,
        statusCode: out.ContentRange ? 206 : 200
      };
    },
    async deleteObject({ key }) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    }
  };
}
