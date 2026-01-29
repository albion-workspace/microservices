/**
 * Unified Real-time Communication Interface
 * 
 * Common interface for SSE and Socket.IO that supports:
 * - Push to specific user
 * - Push to tenant
 * - Push to all users
 * - Push to room (Socket.IO only)
 * - Bidirectional communication (Socket.IO only)
 */

export interface RealtimeBroadcast {
  /**
   * Push event to a specific user
   */
  toUser(userId: string, event: string, data: unknown): void;
  
  /**
   * Push event to all users in a tenant
   */
  toTenant(tenantId: string, event: string, data: unknown): void;
  
  /**
   * Push event to all connected users
   */
  toAll(event: string, data: unknown): void;
  
  /**
   * Push event to a specific room (Socket.IO only, falls back to toAll for SSE)
   */
  toRoom(room: string, event: string, data: unknown): void;
  
  /**
   * Get connection count
   */
  getConnectionCount(): number;
}

/**
 * Socket.IO specific features (bidirectional)
 */
export interface SocketIOFeatures {
  /**
   * Request acknowledgment from client
   */
  toUserWithAck(userId: string, event: string, data: unknown, callback?: (response: unknown) => void): void;
  
  /**
   * Join user to a room
   */
  joinRoom(userId: string, room: string): void;
  
  /**
   * Remove user from a room
   */
  leaveRoom(userId: string, room: string): void;
  
  /**
   * Get rooms for a user
   */
  getUserRooms(userId: string): string[];
}

/**
 * Combined interface for Socket.IO
 */
export interface SocketIOBroadcast extends RealtimeBroadcast, SocketIOFeatures {
  type: 'socket';
}

/**
 * SSE implementation (unidirectional only)
 */
export interface SSEBroadcast extends RealtimeBroadcast {
  type: 'sse';
}

/**
 * Unified real-time provider interface
 */
export interface UnifiedRealtimeProvider {
  /**
   * Get broadcast interface
   */
  getBroadcast(): RealtimeBroadcast;
  
  /**
   * Get Socket.IO specific features (if available)
   */
  getSocketIOFeatures?(): SocketIOFeatures;
  
  /**
   * Check if provider supports bidirectional communication
   */
  isBidirectional(): boolean;
  
  /**
   * Get provider type
   */
  getType(): 'sse' | 'socket';
}
