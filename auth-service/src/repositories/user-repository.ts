/**
 * User Repository
 * 
 * Data access layer for user operations following repository pattern.
 * Provides type-safe, generic methods for user CRUD operations.
 */

import { 
  logger, 
  findById, 
  normalizeDocument, 
  findOneAndUpdateById,
  updateOneById,
  deleteOneById,
  paginateCollection,
  resolveDatabase,
  type DatabaseStrategyResolver,
  type DatabaseContext,
  type Db,
  type Collection,
  type Document,
} from 'core-service';
import type { User, UserFilter, UserQueryOptions, UpdateUserInput, UpdateUserMetadataInput } from '../types/user-types.js';
import type { UserRole, AssignRoleInput } from '../types.js';

export interface UserRepositoryOptions {
  database?: Db;
  databaseStrategy?: DatabaseStrategyResolver;
  defaultContext?: DatabaseContext;
}

/**
 * User Repository for data access operations
 */
export class UserRepository {
  private collectionName = 'users';
  private db: Db | null = null;
  private databaseStrategy: DatabaseStrategyResolver | undefined;
  private defaultContext: DatabaseContext | undefined;
  
  constructor(options?: UserRepositoryOptions) {
    this.db = options?.database || null;
    this.databaseStrategy = options?.databaseStrategy;
    this.defaultContext = options?.defaultContext;
  }
  
  /**
   * Get MongoDB collection
   */
  private async getCollection(tenantId?: string): Promise<Collection<Document>> {
    const db = await resolveDatabase(
      {
        database: this.db || undefined,
        databaseStrategy: this.databaseStrategy,
        defaultContext: this.defaultContext,
      },
      'auth-service',
      tenantId
    );
    
    return db.collection<Document>(this.collectionName);
  }
  
  /**
   * Find user by ID (handles both _id and id fields automatically)
   */
  async findById(userId: string, tenantId: string): Promise<User | null> {
    const collection = await this.getCollection(tenantId);
    const user = await findById<User>(collection, userId, { tenantId });
    return normalizeDocument(user);
  }
  
  /**
   * Find user by MongoDB _id
   */
  async findByMongoId(_id: any, tenantId: string): Promise<User | null> {
    const collection = await this.getCollection(tenantId);
    const user = await collection.findOne({ _id, tenantId }) as any;
    return normalizeDocument(user);
  }
  
  /**
   * Find user by email
   */
  async findByEmail(email: string, tenantId: string): Promise<User | null> {
    const collection = await this.getCollection(tenantId);
    const normalizedEmail = email.toLowerCase().trim();
    const user = await collection.findOne({ 
      email: normalizedEmail, 
      tenantId 
    }) as any;
    return user || null;
  }
  
  /**
   * Find user by username
   */
  async findByUsername(username: string, tenantId: string): Promise<User | null> {
    const collection = await this.getCollection(tenantId);
    const user = await collection.findOne({ 
      username, 
      tenantId 
    }) as any;
    return user || null;
  }
  
  /**
   * Find user by phone
   */
  async findByPhone(phone: string, tenantId: string): Promise<User | null> {
    const collection = await this.getCollection(tenantId);
    const user = await collection.findOne({ 
      phone, 
      tenantId 
    }) as any;
    return user || null;
  }
  
  /**
   * Find user by any identifier (email, username, or phone)
   */
  async findByIdentifier(
    identifier: string,
    tenantId: string
  ): Promise<User | null> {
    const normalizedIdentifier = identifier.toLowerCase().trim();
    
    // Try email first
    let user = await this.findByEmail(normalizedIdentifier, tenantId);
    if (user) return user;
    
    // Try username
    user = await this.findByUsername(identifier, tenantId);
    if (user) return user;
    
    // Try phone
    user = await this.findByPhone(identifier, tenantId);
    if (user) return user;
    
    return null;
  }
  
  /**
   * Create a new user
   */
  async create(user: Omit<User, '_id' | 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
    const collection = await this.getCollection(user.tenantId);
    const now = new Date();
    
    const userDoc: any = {
      ...user,
      createdAt: now,
      updatedAt: now,
    };
    
    const result = await collection.insertOne(userDoc);
    
    // Set id from MongoDB _id
    const createdUser: User = {
      ...userDoc,
      _id: result.insertedId,
      id: result.insertedId.toString(),
    };
    
    logger.info('User created', {
      userId: createdUser.id,
      email: createdUser.email,
      tenantId: createdUser.tenantId,
    });
    
    return createdUser;
  }
  
  /**
   * Update user (handles both _id and id fields automatically)
   */
  async update(input: UpdateUserInput): Promise<User | null> {
    const collection = await this.getCollection(input.tenantId);
    const now = new Date();
    
    const update: any = {
      updatedAt: now,
    };
    
    if (input.username !== undefined) update.username = input.username;
    if (input.email !== undefined) update.email = input.email?.toLowerCase().trim();
    if (input.phone !== undefined) update.phone = input.phone;
    if (input.status !== undefined) update.status = input.status;
    if (input.metadata !== undefined) update.metadata = input.metadata;
    
    // Use optimized helper function for findOneAndUpdate (performance-optimized)
    const result = await findOneAndUpdateById<User>(
      collection,
      input.userId,
      { $set: update },
      { tenantId: input.tenantId },
      { returnDocument: 'after' }
    );
    
    return normalizeDocument(result) || null;
  }
  
  /**
   * Update user metadata (handles both _id and id fields automatically)
   */
  async updateMetadata(input: UpdateUserMetadataInput): Promise<User | null> {
    const collection = await this.getCollection(input.tenantId);
    const now = new Date();
    
    // Use optimized helper function for updateOne (performance-optimized)
    const updateDoc = input.merge
      ? { 'metadata': input.metadata, updatedAt: now }
      : { metadata: input.metadata, updatedAt: now };
    
    await updateOneById(
      collection,
      input.userId,
      { $set: updateDoc },
      { tenantId: input.tenantId }
    );
    
    return this.findById(input.userId, input.tenantId);
  }
  
  /**
   * Add role to user (handles both _id and id fields automatically)
   */
  async addRole(userId: string, tenantId: string, role: UserRole): Promise<void> {
    const collection = await this.getCollection(tenantId);
    const now = new Date();
    
    // Use optimized helper function for updateOne (performance-optimized)
    await updateOneById(
      collection,
      userId,
      {
        $push: { roles: role },
        $set: { updatedAt: now },
      },
      { tenantId }
    );
  }
  
  /**
   * Remove role from user (handles both _id and id fields automatically)
   */
  async removeRole(
    userId: string,
    tenantId: string,
    roleName: string,
    context?: string
  ): Promise<void> {
    const collection = await this.getCollection(tenantId);
    const now = new Date();
    
    const user = await this.findById(userId, tenantId);
    if (!user) {
      throw new Error(`User "${userId}" not found`);
    }
    
    const roles = (user.roles || []).filter(
      (r) => !(r.role === roleName && r.context === context)
    );
    
    // Use optimized helper function for updateOne (performance-optimized)
    await updateOneById(
      collection,
      userId,
      {
        $set: {
          roles,
          updatedAt: now,
        },
      },
      { tenantId }
    );
  }
  
  /**
   * Query users with filters
   * Uses cursor-based pagination for O(1) performance and sharding compatibility
   */
  async query(options: UserQueryOptions = {}): Promise<{ users: User[]; total: number }> {
    const tenantId = options.filter?.tenantId;
    const collection = await this.getCollection(tenantId);
    const { filter = {}, sort, pagination } = options;
    
    // Build query filter
    const queryFilter: any = {};
    
    if (filter.tenantId) queryFilter.tenantId = filter.tenantId;
    if (filter.status) {
      queryFilter.status = Array.isArray(filter.status)
        ? { $in: filter.status }
        : filter.status;
    }
    if (filter.emailVerified !== undefined) queryFilter.emailVerified = filter.emailVerified;
    if (filter.phoneVerified !== undefined) queryFilter.phoneVerified = filter.phoneVerified;
    if (filter.twoFactorEnabled !== undefined) queryFilter.twoFactorEnabled = filter.twoFactorEnabled;
    
    if (filter.createdAfter || filter.createdBefore) {
      queryFilter.createdAt = {};
      if (filter.createdAfter) queryFilter.createdAt.$gte = filter.createdAfter;
      if (filter.createdBefore) queryFilter.createdAt.$lte = filter.createdBefore;
    }
    
    // Role filter
    if (filter.roles && filter.roles.length > 0) {
      queryFilter['roles.role'] = { $in: filter.roles };
      if (filter.context) {
        queryFilter['roles.context'] = filter.context;
      }
    }
    
    // Metadata filter
    if (filter.metadata) {
      for (const [key, value] of Object.entries(filter.metadata)) {
        queryFilter[`metadata.${key}`] = value;
      }
    }
    
    // Determine sort field and direction
    const sortField = sort?.field || 'createdAt';
    const sortDirection = sort?.direction || 'desc';
    
    // Use cursor-based pagination (O(1) performance, sharding-friendly)
    // If no pagination provided, default to first 100 items
    const paginationOptions = pagination || { first: 100 };
    
    const result = await paginateCollection<User>(
      collection,
      {
        first: paginationOptions.first,
        after: paginationOptions.after,
        last: paginationOptions.last,
        before: paginationOptions.before,
        filter: queryFilter,
        sortField,
        sortDirection,
      }
    );
    
    // Get total count if not provided
    let total = result.totalCount;
    if (total === undefined || total === null) {
      total = await collection.countDocuments(queryFilter);
    }
    
    return {
      users: result.edges.map(edge => edge.node),
      total: total || 0,
    };
  }
  
  /**
   * Delete user (soft delete) - handles both _id and id fields automatically
   */
  async delete(userId: string, tenantId: string): Promise<void> {
    const collection = await this.getCollection(tenantId);
    const now = new Date();
    
    // Use optimized helper function for updateOne (performance-optimized)
    await updateOneById(
      collection,
      userId,
      {
        $set: {
          status: 'deleted',
          deletedAt: now,
          updatedAt: now,
        },
      },
      { tenantId }
    );
  }
  
  /**
   * Hard delete user (permanent) - handles both _id and id fields automatically
   */
  async hardDelete(userId: string, tenantId: string): Promise<void> {
    const collection = await this.getCollection(tenantId);
    // Use optimized helper function for deleteOne (performance-optimized)
    await deleteOneById(collection, userId, { tenantId });
  }
  
  /**
   * Update last login timestamp - handles both _id and id fields automatically
   */
  async updateLastLogin(userId: string, tenantId: string): Promise<void> {
    const collection = await this.getCollection(tenantId);
    const now = new Date();
    
    // Use optimized helper function for updateOne (performance-optimized)
    await updateOneById(
      collection,
      userId,
      {
        $set: {
          lastLoginAt: now,
          lastActiveAt: now,
          updatedAt: now,
        },
      },
      { tenantId }
    );
  }
  
  /**
   * Update last active timestamp - handles both _id and id fields automatically
   */
  async updateLastActive(userId: string, tenantId: string): Promise<void> {
    const collection = await this.getCollection(tenantId);
    const now = new Date();
    
    // Use optimized helper function for updateOne (performance-optimized)
    await updateOneById(
      collection,
      userId,
      {
        $set: {
          lastActiveAt: now,
          updatedAt: now,
        },
      },
      { tenantId }
    );
  }
}
