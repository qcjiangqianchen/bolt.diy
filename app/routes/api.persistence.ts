import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import type { Message } from 'ai';
import { queryPostgres, withPostgresTransaction } from '~/lib/.server/db/postgres';
import { requireAuthenticatedUser } from '~/lib/auth/request-user.server';
import type { FileMap } from '~/lib/stores/files';
import { createScopedLogger } from '~/utils/logger';
import type { IChatMetadata } from '~/lib/persistence/db';
import type { Snapshot } from '~/lib/persistence/types';

const logger = createScopedLogger('api.persistence');
const INTERNAL_LOCAL_CHAT_ID = '__boltLocalChatId';

interface ChatHistoryItemPayload {
  id: string;
  urlId?: string;
  description?: string;
  messages: Message[];
  timestamp: string;
  metadata?: IChatMetadata;
}

interface AppUserRow {
  id: string;
  email: string;
}

interface ChatRow {
  id: string;
  project_id: string;
  user_id: string;
  url_id: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface MessageRow {
  client_message_id: string | null;
  role: Message['role'];
  content: string | null;
  raw_message: Message | null;
  created_at: Date | string;
}

interface SnapshotRow {
  id: string;
  client_chat_message_id: string | null;
  summary: string | null;
}

interface SnapshotFileRow {
  path: string;
  entry_type: 'file' | 'folder';
  is_binary: boolean;
  content: string | null;
  metadata: Record<string, unknown> | null;
}

type Operation =
  | 'status'
  | 'sync'
  | 'getAll'
  | 'getMessages'
  | 'setMessages'
  | 'deleteById'
  | 'getNextId'
  | 'getUrlId'
  | 'updateChatDescription'
  | 'updateChatMetadata'
  | 'getSnapshot'
  | 'setSnapshot';

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function getChatUrlId(id: string, urlId?: string): string {
  return (urlId || id).trim();
}

function stripInternalMetadata(metadata: Record<string, unknown> | null | undefined): IChatMetadata | undefined {
  if (!metadata) {
    return undefined;
  }

  const { [INTERNAL_LOCAL_CHAT_ID]: _localChatId, ...rest } = metadata;

  return Object.keys(rest).length > 0 ? (rest as unknown as IChatMetadata) : undefined;
}

function buildChatMetadata(metadata: IChatMetadata | undefined, localChatId: string): Record<string, unknown> {
  return {
    ...(metadata || {}),
    [INTERNAL_LOCAL_CHAT_ID]: localChatId,
  };
}

async function requireDbUser({ request, context }: ActionFunctionArgs | LoaderFunctionArgs): Promise<AppUserRow> {
  const authenticatedUser = await requireAuthenticatedUser(request, context);

  if (authenticatedUser instanceof Response) {
    throw authenticatedUser;
  }

  if (!authenticatedUser.email) {
    throw json(
      {
        error: 'Remote persistence requires an authenticated account.',
      },
      { status: 401 },
    );
  }

  const email = authenticatedUser.email.trim().toLowerCase();
  const result = await queryPostgres<AppUserRow>(
    context,
    `
      insert into app_users (email, verified_at)
      values ($1, now())
      on conflict (email) do update
        set updated_at = now()
      returning id, email
    `,
    [email],
  );

  return result.rows[0];
}

async function digestContent(content: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(content).digest('hex');
}

async function findChat(
  context: ActionFunctionArgs['context'],
  userId: string,
  id: string,
): Promise<ChatRow | undefined> {
  const result = await queryPostgres<ChatRow>(
    context,
    `
      select id, project_id, user_id, url_id, description, metadata, created_at, updated_at
      from chats
      where user_id = $1
        and (
          url_id = $2
          or metadata ->> $3 = $2
        )
      limit 1
    `,
    [userId, id, INTERNAL_LOCAL_CHAT_ID],
  );

  return result.rows[0];
}

async function getMessagesForChat(
  context: ActionFunctionArgs['context'],
  userId: string,
  id: string,
): Promise<ChatHistoryItemPayload | undefined> {
  const chat = await findChat(context, userId, id);

  if (!chat) {
    return undefined;
  }

  const messagesResult = await queryPostgres<MessageRow>(
    context,
    `
      select client_message_id, role, content, raw_message, created_at
      from chat_messages
      where chat_id = $1
      order by sequence asc
    `,
    [chat.id],
  );

  const messages = messagesResult.rows.map((row) => {
    if (row.raw_message) {
      return row.raw_message;
    }

    return {
      id: row.client_message_id || crypto.randomUUID(),
      role: row.role,
      content: row.content || '',
    } satisfies Message;
  });

  return {
    id: chat.url_id,
    urlId: chat.url_id,
    description: chat.description || undefined,
    messages,
    timestamp: toIsoString(chat.updated_at || chat.created_at),
    metadata: stripInternalMetadata(chat.metadata),
  };
}

async function upsertChatWithMessages(
  context: ActionFunctionArgs['context'],
  userId: string,
  chat: ChatHistoryItemPayload,
): Promise<ChatHistoryItemPayload> {
  const urlId = getChatUrlId(chat.id, chat.urlId);
  const timestamp =
    chat.timestamp && !Number.isNaN(Date.parse(chat.timestamp)) ? chat.timestamp : new Date().toISOString();
  const metadata = buildChatMetadata(chat.metadata, chat.id);

  return withPostgresTransaction(context, async (client) => {
    const existing = await client.query<ChatRow>(
      `
        select id, project_id, user_id, url_id, description, metadata, created_at, updated_at
        from chats
        where user_id = $1
          and (
            url_id = $2
            or metadata ->> $3 = $4
          )
        limit 1
      `,
      [userId, urlId, INTERNAL_LOCAL_CHAT_ID, chat.id],
    );

    let chatId = existing.rows[0]?.id;
    let projectId = existing.rows[0]?.project_id;

    if (!chatId || !projectId) {
      const projectResult = await client.query<{ id: string }>(
        `
          insert into projects (user_id, title, description, created_at, updated_at)
          values ($1, $2, $3, $4, $4)
          returning id
        `,
        [userId, chat.description || 'Untitled project', chat.description || null, timestamp],
      );
      projectId = projectResult.rows[0].id;

      const chatResult = await client.query<{ id: string }>(
        `
          insert into chats (project_id, user_id, title, description, url_id, metadata, created_at, updated_at)
          values ($1, $2, $3, $4, $5, $6::jsonb, $7, $7)
          returning id
        `,
        [
          projectId,
          userId,
          chat.description || null,
          chat.description || null,
          urlId,
          JSON.stringify(metadata),
          timestamp,
        ],
      );
      chatId = chatResult.rows[0].id;

      await client.query('update projects set current_chat_id = $1 where id = $2', [chatId, projectId]);
    } else {
      await client.query(
        `
          update chats
          set description = $3,
              title = coalesce($3, title),
              url_id = $4,
              metadata = $5::jsonb,
              updated_at = now()
          where id = $1 and user_id = $2
        `,
        [chatId, userId, chat.description || null, urlId, JSON.stringify(metadata)],
      );

      await client.query(
        `
          update projects
          set title = coalesce($2, title),
              description = $2,
              updated_at = now()
          where id = $1 and user_id = $3
        `,
        [projectId, chat.description || null, userId],
      );
    }

    await client.query('delete from chat_messages where chat_id = $1', [chatId]);

    for (const [index, message] of chat.messages.entries()) {
      await client.query(
        `
          insert into chat_messages (
            chat_id,
            project_id,
            user_id,
            client_message_id,
            role,
            sequence,
            content,
            raw_message,
            created_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now())
        `,
        [
          chatId,
          projectId,
          userId,
          message.id || null,
          message.role,
          index,
          typeof message.content === 'string' ? message.content : null,
          JSON.stringify(message),
        ],
      );
    }

    return {
      ...chat,
      id: urlId,
      urlId,
      timestamp,
    };
  });
}

async function getAllChats(context: ActionFunctionArgs['context'], userId: string): Promise<ChatHistoryItemPayload[]> {
  const result = await queryPostgres<ChatRow>(
    context,
    `
      select id, project_id, user_id, url_id, description, metadata, created_at, updated_at
      from chats
      where user_id = $1
      order by updated_at desc
    `,
    [userId],
  );

  return result.rows.map((chat) => ({
    id: chat.url_id,
    urlId: chat.url_id,
    description: chat.description || undefined,
    messages: [],
    timestamp: toIsoString(chat.updated_at || chat.created_at),
    metadata: stripInternalMetadata(chat.metadata),
  }));
}

async function setSnapshotForChat(
  context: ActionFunctionArgs['context'],
  userId: string,
  chatIdOrUrlId: string,
  snapshot: Snapshot,
): Promise<void> {
  const chat = await findChat(context, userId, chatIdOrUrlId);

  if (!chat) {
    throw json({ error: 'Chat not found' }, { status: 404 });
  }

  await withPostgresTransaction(context, async (client) => {
    const snapshotResult = await client.query<{ id: string }>(
      `
        insert into project_snapshots (project_id, chat_id, client_chat_message_id, summary, manifest)
        values ($1, $2, $3, $4, '{}'::jsonb)
        returning id
      `,
      [chat.project_id, chat.id, snapshot.chatIndex, snapshot.summary || null],
    );
    const snapshotId = snapshotResult.rows[0].id;

    for (const [filePath, entry] of Object.entries(snapshot.files)) {
      if (!entry) {
        continue;
      }

      if (entry.type === 'folder') {
        await client.query(
          `
            insert into snapshot_files (snapshot_id, path, entry_type, metadata)
            values ($1, $2, 'folder', $3::jsonb)
            on conflict (snapshot_id, path) do update
              set entry_type = excluded.entry_type,
                  metadata = excluded.metadata
          `,
          [snapshotId, filePath, JSON.stringify(entry)],
        );
        continue;
      }

      const contentHash = await digestContent(entry.content || '');
      const sizeBytes = new TextEncoder().encode(entry.content || '').byteLength;

      await client.query(
        `
          insert into file_blobs (content_hash, content, size_bytes, is_binary)
          values ($1, $2, $3, $4)
          on conflict (content_hash) do nothing
        `,
        [contentHash, entry.content || '', sizeBytes, Boolean(entry.isBinary)],
      );

      await client.query(
        `
          insert into snapshot_files (snapshot_id, path, entry_type, content_hash, is_binary, size_bytes, metadata)
          values ($1, $2, 'file', $3, $4, $5, $6::jsonb)
          on conflict (snapshot_id, path) do update
            set content_hash = excluded.content_hash,
                is_binary = excluded.is_binary,
                size_bytes = excluded.size_bytes,
                metadata = excluded.metadata
        `,
        [snapshotId, filePath, contentHash, Boolean(entry.isBinary), sizeBytes, JSON.stringify(entry)],
      );
    }

    await client.query('update projects set current_snapshot_id = $1, updated_at = now() where id = $2', [
      snapshotId,
      chat.project_id,
    ]);
  });
}

async function getSnapshotForChat(
  context: ActionFunctionArgs['context'],
  userId: string,
  chatIdOrUrlId: string,
): Promise<Snapshot | undefined> {
  const chat = await findChat(context, userId, chatIdOrUrlId);

  if (!chat) {
    return undefined;
  }

  const snapshotResult = await queryPostgres<SnapshotRow>(
    context,
    `
      select id, client_chat_message_id, summary
      from project_snapshots
      where project_id = $1
      order by created_at desc
      limit 1
    `,
    [chat.project_id],
  );
  const snapshot = snapshotResult.rows[0];

  if (!snapshot) {
    return undefined;
  }

  const filesResult = await queryPostgres<SnapshotFileRow>(
    context,
    `
      select sf.path, sf.entry_type, sf.is_binary, fb.content, sf.metadata
      from snapshot_files sf
      left join file_blobs fb on fb.content_hash = sf.content_hash
      where sf.snapshot_id = $1
      order by sf.path asc
    `,
    [snapshot.id],
  );

  const files: FileMap = {};

  for (const file of filesResult.rows) {
    if (file.entry_type === 'folder') {
      files[file.path] = {
        ...(file.metadata || {}),
        type: 'folder',
      };
    } else {
      files[file.path] = {
        ...(file.metadata || {}),
        type: 'file',
        content: file.content || '',
        isBinary: file.is_binary,
      };
    }
  }

  return {
    chatIndex: snapshot.client_chat_message_id || '',
    files,
    summary: snapshot.summary || undefined,
  };
}

async function getNextUrlId(context: ActionFunctionArgs['context'], userId: string): Promise<string> {
  const result = await queryPostgres<{ next_id: string | number | null }>(
    context,
    `
      select coalesce(max(url_id::integer), 0) + 1 as next_id
      from chats
      where user_id = $1
        and url_id ~ '^[0-9]+$'
    `,
    [userId],
  );

  return String(result.rows[0]?.next_id || 1);
}

async function getAvailableUrlId(
  context: ActionFunctionArgs['context'],
  userId: string,
  candidate: string,
): Promise<string> {
  const existingResult = await queryPostgres<{ url_id: string }>(
    context,
    'select url_id from chats where user_id = $1',
    [userId],
  );
  const existing = new Set(existingResult.rows.map((row) => row.url_id));

  if (!existing.has(candidate)) {
    return candidate;
  }

  let suffix = 2;

  while (existing.has(`${candidate}-${suffix}`)) {
    suffix++;
  }

  return `${candidate}-${suffix}`;
}

export async function loader(args: LoaderFunctionArgs) {
  await requireDbUser(args);

  return json({
    enabled: true,
  });
}

export async function action(args: ActionFunctionArgs) {
  const dbUser = await requireDbUser(args);
  const body = (await args.request.json()) as { operation?: Operation; [key: string]: unknown };
  const operation = body.operation;

  try {
    switch (operation) {
      case 'status': {
        return json({ enabled: true });
      }
      case 'sync': {
        const chats = (body.chats || []) as ChatHistoryItemPayload[];
        const snapshots = (body.snapshots || {}) as Record<string, Snapshot | undefined>;

        for (const chat of chats) {
          const savedChat = await upsertChatWithMessages(args.context, dbUser.id, chat);
          const snapshot = snapshots[chat.id] || snapshots[chat.urlId || ''] || snapshots[savedChat.urlId || ''];

          if (snapshot) {
            await setSnapshotForChat(args.context, dbUser.id, savedChat.urlId || savedChat.id, snapshot);
          }
        }

        return json({ ok: true });
      }
      case 'getAll': {
        return json({ chats: await getAllChats(args.context, dbUser.id) });
      }
      case 'getMessages': {
        const chat = await getMessagesForChat(args.context, dbUser.id, String(body.id || ''));
        return json({ chat: chat || null });
      }
      case 'setMessages': {
        const savedChat = await upsertChatWithMessages(args.context, dbUser.id, {
          id: String(body.id || ''),
          urlId: typeof body.urlId === 'string' ? body.urlId : undefined,
          description: typeof body.description === 'string' ? body.description : undefined,
          messages: (body.messages || []) as Message[],
          timestamp: typeof body.timestamp === 'string' ? body.timestamp : new Date().toISOString(),
          metadata: body.metadata as IChatMetadata | undefined,
        });

        return json({ chat: savedChat });
      }
      case 'deleteById': {
        const chat = await findChat(args.context, dbUser.id, String(body.id || ''));

        if (chat) {
          await withPostgresTransaction(args.context, async (client) => {
            await client.query('delete from chats where id = $1 and user_id = $2', [chat.id, dbUser.id]);
            await client.query(
              `
                delete from projects p
                where p.id = $1
                  and p.user_id = $2
                  and not exists (select 1 from chats c where c.project_id = p.id)
              `,
              [chat.project_id, dbUser.id],
            );
          });
        }

        return json({ ok: true });
      }
      case 'getNextId': {
        return json({ id: await getNextUrlId(args.context, dbUser.id) });
      }
      case 'getUrlId': {
        return json({ urlId: await getAvailableUrlId(args.context, dbUser.id, String(body.id || '')) });
      }
      case 'updateChatDescription': {
        const chat = await findChat(args.context, dbUser.id, String(body.id || ''));

        if (!chat) {
          throw json({ error: 'Chat not found' }, { status: 404 });
        }

        const description = String(body.description || '').trim();
        await queryPostgres(
          args.context,
          `
            update chats
            set description = $3,
                title = $3,
                updated_at = now()
            where id = $1 and user_id = $2
          `,
          [chat.id, dbUser.id, description],
        );
        await queryPostgres(
          args.context,
          'update projects set title = $2, description = $2, updated_at = now() where id = $1 and user_id = $3',
          [chat.project_id, description, dbUser.id],
        );

        return json({ ok: true });
      }
      case 'updateChatMetadata': {
        const chat = await findChat(args.context, dbUser.id, String(body.id || ''));

        if (!chat) {
          throw json({ error: 'Chat not found' }, { status: 404 });
        }

        const localChatId =
          typeof chat.metadata?.[INTERNAL_LOCAL_CHAT_ID] === 'string'
            ? chat.metadata[INTERNAL_LOCAL_CHAT_ID]
            : chat.url_id;
        const metadata = buildChatMetadata(body.metadata as IChatMetadata | undefined, localChatId);

        await queryPostgres(
          args.context,
          'update chats set metadata = $3::jsonb, updated_at = now() where id = $1 and user_id = $2',
          [chat.id, dbUser.id, JSON.stringify(metadata)],
        );

        return json({ ok: true });
      }
      case 'getSnapshot': {
        const snapshot = await getSnapshotForChat(args.context, dbUser.id, String(body.id || ''));
        return json({ snapshot: snapshot || null });
      }
      case 'setSnapshot': {
        await setSnapshotForChat(args.context, dbUser.id, String(body.id || ''), body.snapshot as Snapshot);
        return json({ ok: true });
      }
      default: {
        return json({ error: 'Unknown persistence operation' }, { status: 400 });
      }
    }
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }

    logger.error('Persistence operation failed', error);

    return json({ error: 'Persistence operation failed' }, { status: 500 });
  }
}
