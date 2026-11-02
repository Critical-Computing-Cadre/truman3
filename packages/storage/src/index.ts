import {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export interface StorageConfig {
  /** Leave out to use AWS S3. Set it for an S3-compatible service like the local SeaweedFS. */
  endpoint?: string | undefined;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export type Storage = ReturnType<typeof createStorage>;

/** Reads the storage settings from environment variables. Throws if any are missing. */
export function storageConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  const required = (name: string) => {
    const value = env[name];
    if (!value) {
      throw new Error(`${name} isn't set. See .env.example.`);
    }
    return value;
  };

  return {
    endpoint: env.S3_ENDPOINT,
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  };
}

/** File storage over the S3 protocol, so the same code works locally and on AWS. */
export function createStorage(config: StorageConfig) {
  const client = new S3Client({
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
  });
  const Bucket = config.bucket;

  return {
    /** Creates the bucket if it isn't there yet. */
    ensureBucket: async () => {
      try {
        await client.send(new HeadBucketCommand({ Bucket }));
      } catch {
        await client.send(new CreateBucketCommand({ Bucket }));
      }
    },

    exists: async (key: string) => {
      try {
        await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return true;
      } catch (error) {
        if ((error as { name?: string }).name === "NotFound") {
          return false;
        }
        throw error;
      }
    },

    put: async (key: string, body: Uint8Array, contentType: string) => {
      await client.send(
        new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },

    delete: async (key: string) => {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },

    /** Deletes everything whose key starts with this prefix. Returns how many it deleted. */
    deletePrefix: async (prefix: string) => {
      let deleted = 0;
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket,
            Prefix: prefix,
            ...(token ? { ContinuationToken: token } : {}),
          }),
        );
        for (const object of page.Contents ?? []) {
          if (object.Key) {
            await client.send(new DeleteObjectCommand({ Bucket, Key: object.Key }));
            deleted += 1;
          }
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return deleted;
    },

    close: () => client.destroy(),
  };
}
