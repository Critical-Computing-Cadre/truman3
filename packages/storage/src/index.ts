import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";

export interface StorageConfig {
  /** Leave out to use AWS S3. Set it for an S3-compatible service like the local SeaweedFS. */
  endpoint?: string | undefined;
  region: string;
  bucket: string;
  /** Leave both keys out on AWS, to use the container's role. See clientConfig. */
  accessKeyId?: string | undefined;
  secretAccessKey?: string | undefined;
}

export type Storage = ReturnType<typeof createStorage>;

/** Reads the storage settings from environment variables. Throws if a required one is missing. */
export function storageConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  const required = (name: string) => {
    const value = env[name];
    if (!value) {
      throw new Error(`${name} isn't set. See .env.example.`);
    }
    return value;
  };

  // One key without the other is a mistake, and would otherwise fall back to some other credentials.
  const accessKeyId = env.S3_ACCESS_KEY_ID;
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY;
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new Error("Set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither.");
  }

  return {
    endpoint: env.S3_ENDPOINT,
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    accessKeyId,
    secretAccessKey,
  };
}

/**
 * How to reach storage. With keys, it uses them. Without, the AWS SDK finds credentials the usual
 * way, which in a container on AWS means the role the container runs with, so no key is stored.
 */
export function clientConfig(config: StorageConfig): S3ClientConfig {
  return {
    region: config.region,
    ...(config.accessKeyId && config.secretAccessKey
      ? {
          credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          },
        }
      : {}),
    ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
  };
}

/** File storage over the S3 protocol, so the same code works locally and on AWS. */
export function createStorage(config: StorageConfig) {
  const client = new S3Client(clientConfig(config));
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

    /** A file's contents as a stream, or null if there's no such file. */
    get: async (key: string) => {
      try {
        const object = await client.send(new GetObjectCommand({ Bucket, Key: key }));
        return object.Body ? object.Body.transformToWebStream() : null;
      } catch (error) {
        const name = (error as { name?: string }).name;
        if (name === "NoSuchKey" || name === "NotFound") {
          return null;
        }
        throw error;
      }
    },

    /**
     * `kmsKeyId` encrypts this one file with that key in AWS KMS, in place of the bucket's own. A
     * lab's key, for what its participants upload (ADR 82). Reading it back needs nothing extra.
     */
    put: async (
      key: string,
      body: Uint8Array,
      contentType: string,
      { kmsKeyId }: { kmsKeyId?: string | undefined } = {},
    ) => {
      await client.send(
        new PutObjectCommand({
          Bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ...(kmsKeyId ? { ServerSideEncryption: "aws:kms", SSEKMSKeyId: kmsKeyId } : {}),
        }),
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
