import type { Message } from 'ai';
import { createScopedLogger } from '~/utils/logger';
import type { ChatHistoryItem } from './useChatHistory';
import type { Snapshot } from './types'; // Import Snapshot type

export interface IChatMetadata {
  gitUrl: string;
  gitBranch?: string;
  netlifySiteId?: string;
  deployedUrl?: string;
  deployedAt?: string;
}

const logger = createScopedLogger('ChatHistory');
const REMOTE_PERSISTENCE_API = '/api/persistence';
const REMOTE_SYNC_VERSION = 'core-postgres-v1';

interface RemotePersistenceResponse<T> {
  error?: string;
  enabled?: boolean;
  ok?: boolean;
  chat?: ChatHistoryItem | null;
  chats?: ChatHistoryItem[];
  id?: string;
  urlId?: string;
  snapshot?: Snapshot | null;
  data?: T;
}

function getUserScopedDatabaseName(): string {
  if (typeof document === 'undefined') {
    return 'boltHistory';
  }

  const cookieEntry = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('bolt_user_key='));

  if (!cookieEntry) {
    return 'boltHistory_anonymous';
  }

  const rawValue = cookieEntry.slice('bolt_user_key='.length);
  const namespacedUser = decodeURIComponent(rawValue || '').replace(/[^a-zA-Z0-9_-]/g, '_');

  if (!namespacedUser) {
    return 'boltHistory_anonymous';
  }

  return `boltHistory_${namespacedUser}`;
}

// this is used at the top level and never rejects
export async function openDatabase(): Promise<IDBDatabase | undefined> {
  if (typeof indexedDB === 'undefined') {
    console.error('indexedDB is not available in this environment.');
    return undefined;
  }

  return new Promise((resolve) => {
    const request = indexedDB.open(getUserScopedDatabaseName(), 2);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const oldVersion = event.oldVersion;

      if (oldVersion < 1) {
        if (!db.objectStoreNames.contains('chats')) {
          const store = db.createObjectStore('chats', { keyPath: 'id' });
          store.createIndex('id', 'id', { unique: true });
          store.createIndex('urlId', 'urlId', { unique: true });
        }
      }

      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains('snapshots')) {
          db.createObjectStore('snapshots', { keyPath: 'chatId' });
        }
      }
    };

    request.onsuccess = (event: Event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event: Event) => {
      resolve(undefined);
      logger.error((event.target as IDBOpenDBRequest).error);
    };
  });
}

async function remotePersistenceRequest<T>(
  operation: string,
  payload: Record<string, unknown> = {},
): Promise<RemotePersistenceResponse<T> | undefined> {
  try {
    const response = await fetch(REMOTE_PERSISTENCE_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operation,
        ...payload,
      }),
    });

    if (response.status === 401 || response.status === 404) {
      return undefined;
    }

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || `Remote persistence failed: ${response.status}`);
    }

    return (await response.json()) as RemotePersistenceResponse<T>;
  } catch (error) {
    logger.debug('Remote persistence request unavailable', { operation, error });
    return undefined;
  }
}

async function isRemotePersistenceAvailable(): Promise<boolean> {
  const response = await remotePersistenceRequest('status');
  return Boolean(response?.enabled);
}

async function getSnapshotsForSync(db: IDBDatabase): Promise<Record<string, Snapshot | undefined>> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('snapshots', 'readonly');
    const store = transaction.objectStore('snapshots');
    const request = store.openCursor();
    const snapshots: Record<string, Snapshot | undefined> = {};

    request.onsuccess = (event: Event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

      if (!cursor) {
        resolve(snapshots);
        return;
      }

      snapshots[cursor.value.chatId] = cursor.value.snapshot as Snapshot | undefined;
      cursor.continue();
    };

    request.onerror = () => reject(request.error);
  });
}

async function syncLocalToRemote(db: IDBDatabase): Promise<void> {
  if (typeof localStorage === 'undefined') {
    return;
  }

  const syncKey = `bolt-remote-sync:${db.name}`;

  if (localStorage.getItem(syncKey) === REMOTE_SYNC_VERSION) {
    return;
  }

  if (!(await isRemotePersistenceAvailable())) {
    return;
  }

  const [chats, snapshots] = await Promise.all([getAllLocal(db), getSnapshotsForSync(db)]);

  if (chats.length === 0) {
    localStorage.setItem(syncKey, REMOTE_SYNC_VERSION);
    return;
  }

  const response = await remotePersistenceRequest('sync', { chats, snapshots });

  if (response?.ok) {
    localStorage.setItem(syncKey, REMOTE_SYNC_VERSION);
  }
}

async function withRemoteFallback<T>(
  db: IDBDatabase,
  remoteOperation: () => Promise<T | undefined>,
  localOperation: () => Promise<T>,
): Promise<T> {
  await syncLocalToRemote(db);

  const remoteResult = await remoteOperation();

  if (remoteResult !== undefined) {
    return remoteResult;
  }

  return localOperation();
}

async function getAllLocal(db: IDBDatabase): Promise<ChatHistoryItem[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readonly');
    const store = transaction.objectStore('chats');
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result as ChatHistoryItem[]);
    request.onerror = () => reject(request.error);
  });
}

export async function getAll(db: IDBDatabase): Promise<ChatHistoryItem[]> {
  return withRemoteFallback(
    db,
    async () => {
      const response = await remotePersistenceRequest('getAll');
      return response?.chats;
    },
    () => getAllLocal(db),
  );
}

async function setMessagesLocal(
  db: IDBDatabase,
  id: string,
  messages: Message[],
  urlId?: string,
  description?: string,
  timestamp?: string,
  metadata?: IChatMetadata,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readwrite');
    const store = transaction.objectStore('chats');

    if (timestamp && isNaN(Date.parse(timestamp))) {
      reject(new Error('Invalid timestamp'));
      return;
    }

    const request = store.put({
      id,
      messages,
      urlId,
      description,
      timestamp: timestamp ?? new Date().toISOString(),
      metadata,
    });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function setMessages(
  db: IDBDatabase,
  id: string,
  messages: Message[],
  urlId?: string,
  description?: string,
  timestamp?: string,
  metadata?: IChatMetadata,
): Promise<void> {
  await setMessagesLocal(db, id, messages, urlId, description, timestamp, metadata);
  await syncLocalToRemote(db);

  await remotePersistenceRequest('setMessages', {
    id,
    messages,
    urlId,
    description,
    timestamp,
    metadata,
  });
}

export async function getMessages(db: IDBDatabase, id: string): Promise<ChatHistoryItem> {
  return withRemoteFallback(
    db,
    async () => {
      const response = await remotePersistenceRequest('getMessages', { id });
      return response?.chat || undefined;
    },
    async () => (await getMessagesById(db, id)) || (await getMessagesByUrlId(db, id)),
  );
}

async function getMessagesByUrlIdLocal(db: IDBDatabase, id: string): Promise<ChatHistoryItem> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readonly');
    const store = transaction.objectStore('chats');
    const index = store.index('urlId');
    const request = index.get(id);

    request.onsuccess = () => resolve(request.result as ChatHistoryItem);
    request.onerror = () => reject(request.error);
  });
}

export async function getMessagesByUrlId(db: IDBDatabase, id: string): Promise<ChatHistoryItem> {
  return getMessagesByUrlIdLocal(db, id);
}

async function getMessagesByIdLocal(db: IDBDatabase, id: string): Promise<ChatHistoryItem> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readonly');
    const store = transaction.objectStore('chats');
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result as ChatHistoryItem);
    request.onerror = () => reject(request.error);
  });
}

export async function getMessagesById(db: IDBDatabase, id: string): Promise<ChatHistoryItem> {
  return getMessagesByIdLocal(db, id);
}

async function deleteByIdLocal(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['chats', 'snapshots'], 'readwrite'); // Add snapshots store to transaction
    const chatStore = transaction.objectStore('chats');
    const snapshotStore = transaction.objectStore('snapshots');

    const deleteChatRequest = chatStore.delete(id);
    const deleteSnapshotRequest = snapshotStore.delete(id); // Also delete snapshot

    let chatDeleted = false;
    let snapshotDeleted = false;

    const checkCompletion = () => {
      if (chatDeleted && snapshotDeleted) {
        resolve(undefined);
      }
    };

    deleteChatRequest.onsuccess = () => {
      chatDeleted = true;
      checkCompletion();
    };
    deleteChatRequest.onerror = () => reject(deleteChatRequest.error);

    deleteSnapshotRequest.onsuccess = () => {
      snapshotDeleted = true;
      checkCompletion();
    };

    deleteSnapshotRequest.onerror = (event) => {
      if ((event.target as IDBRequest).error?.name === 'NotFoundError') {
        snapshotDeleted = true;
        checkCompletion();
      } else {
        reject(deleteSnapshotRequest.error);
      }
    };

    transaction.oncomplete = () => {
      // This might resolve before checkCompletion if one operation finishes much faster
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function deleteById(db: IDBDatabase, id: string): Promise<void> {
  await syncLocalToRemote(db);
  await remotePersistenceRequest('deleteById', { id });
  await deleteByIdLocal(db, id);
}

async function getNextIdLocal(db: IDBDatabase): Promise<string> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readonly');
    const store = transaction.objectStore('chats');
    const request = store.getAllKeys();

    request.onsuccess = () => {
      const highestId = request.result.reduce((cur, acc) => Math.max(+cur, +acc), 0);
      resolve(String(+highestId + 1));
    };

    request.onerror = () => reject(request.error);
  });
}

export async function getNextId(db: IDBDatabase): Promise<string> {
  return withRemoteFallback(
    db,
    async () => {
      const response = await remotePersistenceRequest('getNextId');
      return response?.id;
    },
    () => getNextIdLocal(db),
  );
}

export async function getUrlId(db: IDBDatabase, id: string): Promise<string> {
  await syncLocalToRemote(db);

  const remoteResponse = await remotePersistenceRequest('getUrlId', { id });

  if (remoteResponse?.urlId) {
    return remoteResponse.urlId;
  }

  const idList = await getUrlIds(db);

  if (!idList.includes(id)) {
    return id;
  } else {
    let i = 2;

    while (idList.includes(`${id}-${i}`)) {
      i++;
    }

    return `${id}-${i}`;
  }
}

async function getUrlIds(db: IDBDatabase): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readonly');
    const store = transaction.objectStore('chats');
    const idList: string[] = [];

    const request = store.openCursor();

    request.onsuccess = (event: Event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

      if (cursor) {
        idList.push(cursor.value.urlId);
        cursor.continue();
      } else {
        resolve(idList);
      }
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

export async function forkChat(db: IDBDatabase, chatId: string, messageId: string): Promise<string> {
  const chat = await getMessages(db, chatId);

  if (!chat) {
    throw new Error('Chat not found');
  }

  // Find the index of the message to fork at
  const messageIndex = chat.messages.findIndex((msg) => msg.id === messageId);

  if (messageIndex === -1) {
    throw new Error('Message not found');
  }

  // Get messages up to and including the selected message
  const messages = chat.messages.slice(0, messageIndex + 1);

  return createChatFromMessages(db, chat.description ? `${chat.description} (fork)` : 'Forked chat', messages);
}

export async function duplicateChat(db: IDBDatabase, id: string): Promise<string> {
  const chat = await getMessages(db, id);

  if (!chat) {
    throw new Error('Chat not found');
  }

  return createChatFromMessages(db, `${chat.description || 'Chat'} (copy)`, chat.messages);
}

export async function createChatFromMessages(
  db: IDBDatabase,
  description: string,
  messages: Message[],
  metadata?: IChatMetadata,
): Promise<string> {
  const newId = await getNextId(db);
  const newUrlId = await getUrlId(db, newId); // Get a new urlId for the duplicated chat

  await setMessages(
    db,
    newId,
    messages,
    newUrlId, // Use the new urlId
    description,
    undefined, // Use the current timestamp
    metadata,
  );

  return newUrlId; // Return the urlId instead of id for navigation
}

export async function updateChatDescription(db: IDBDatabase, id: string, description: string): Promise<void> {
  const chat = await getMessages(db, id);

  if (!chat) {
    throw new Error('Chat not found');
  }

  if (!description.trim()) {
    throw new Error('Description cannot be empty');
  }

  await setMessagesLocal(db, id, chat.messages, chat.urlId, description, chat.timestamp, chat.metadata);
  await syncLocalToRemote(db);
  await remotePersistenceRequest('updateChatDescription', { id, description });
}

export async function updateChatMetadata(
  db: IDBDatabase,
  id: string,
  metadata: IChatMetadata | undefined,
): Promise<void> {
  const chat = await getMessages(db, id);

  if (!chat) {
    throw new Error('Chat not found');
  }

  await setMessagesLocal(db, id, chat.messages, chat.urlId, chat.description, chat.timestamp, metadata);
  await syncLocalToRemote(db);
  await remotePersistenceRequest('updateChatMetadata', { id, metadata });
}

async function getSnapshotLocal(db: IDBDatabase, chatId: string): Promise<Snapshot | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('snapshots', 'readonly');
    const store = transaction.objectStore('snapshots');
    const request = store.get(chatId);

    request.onsuccess = () => resolve(request.result?.snapshot as Snapshot | undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function getSnapshot(db: IDBDatabase, chatId: string): Promise<Snapshot | undefined> {
  return withRemoteFallback(
    db,
    async () => {
      const response = await remotePersistenceRequest('getSnapshot', { id: chatId });
      return response?.snapshot || undefined;
    },
    () => getSnapshotLocal(db, chatId),
  );
}

async function setSnapshotLocal(db: IDBDatabase, chatId: string, snapshot: Snapshot): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('snapshots', 'readwrite');
    const store = transaction.objectStore('snapshots');
    const request = store.put({ chatId, snapshot });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function setSnapshot(db: IDBDatabase, chatId: string, snapshot: Snapshot): Promise<void> {
  await setSnapshotLocal(db, chatId, snapshot);
  await syncLocalToRemote(db);
  await remotePersistenceRequest('setSnapshot', { id: chatId, snapshot });
}

export async function deleteSnapshot(db: IDBDatabase, chatId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('snapshots', 'readwrite');
    const store = transaction.objectStore('snapshots');
    const request = store.delete(chatId);

    request.onsuccess = () => resolve();

    request.onerror = (event) => {
      if ((event.target as IDBRequest).error?.name === 'NotFoundError') {
        resolve();
      } else {
        reject(request.error);
      }
    };
  });
}
