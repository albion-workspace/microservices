/**
 * User Repository
 * 
 * Data access layer for user operations following repository pattern.
 * Provides type-safe, generic methods for user CRUD operations.
 */

import { getDatabase, logger } from 'core-service';
import type { User, UserFilter, UserQueryOptions, UpdateUserInput, UpdateUserMetadataInput } from '../types/user-types.js';
import type { UserRole, AssignRoleInput } from '../types/role-types.js';

/**
 * User Repository for data access operations
 */
export class UserRepository {
  private collectionName = 'users';
  
  /**
   * Get MongoDB collection
   */
  private getCollection() {
    const db = getDatabase();
    return db.collection(this.collectionName);
  }
  
  /**
   * Find user by ID
   */
  async findById(userId: string, tenantId: string): Promise<User | null> {
    const collection = this.getCollection();
    const user = await collection.findOne({ id: userId, tenantId }) as any;
    return user || null;
  }
  
  /**
   * Find user by MongoDB _id
   */
  async findByMongoId(_id: any, tenantId: string): Promise<User | null> {
    const collection = this.getCollection();
    const user = await collection.findOne({ _id, tenantId }) as any;
    return user || null;
  }
  
  /**
   * Find user by email
   */
  async findByEmail(email: string, tenantId: string): Promise<User | null> {
    const collection = this.getCollection();
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
    const collection = this.getCollection();
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
    const collection = this.getCollection();
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
    const collection = this.getCollection();
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
   * Update user
   */
  async update(input: UpdateUserInput): Promise<User | null> {
    const collection = this.getCollection();
    const now = new Date();
    
    const update: any = {
      updatedAt: now,
    };
    
    if (input.username !== undefined) update.username = input.username;
    if (input.email !== undefined) update.email = input.email?.toLowerCase().trim();
    if (input.phone !== undefined) update.phone = input.phone;
    if (input.status !== undefined) update.status = input.status;
    if (input.metadata !== undefined) update.metadata = input.metadata;
    
    const result = await collection.findOneAndUpdate(
      { id: input.userId, tenantId: input.tenantId },
      { $set: update },
      { returnDocument: 'after' }
    );
    
    return result as any || null;
  }
  
  /**
   * Update user metadata
   */
  async updateMetadata(input: UpdateUserMetadataInput): Promise<User | null> {
    const collection = this.getCollection();
    const now = new Date();
    
    if (input.merge) {
      // Merge with existing metadata
      await collection.updateOne(
        { id: input.userId, tenantId: input.tenantId },
        {
          $set: {
            'metadata': input.metadata,
            updatedAt: now,
          },
        }
      );
    } else {
      // Replace metadata
      await collection.updateOne(
        { id: input.userId, tenantId: input.tenantId },
        {
          $set: {
            metadata: input.metadata,
            updatedAt: now,
          },
        }
      );
    }
    
    return this.findById(input.userId, input.tenantId);
  }
  
  /**
   * Add role to user
   */
  async addRole(userId: string, tenantId: string, role: UserRole): Promise<void> {
    const collection = this.getCollection();
    const now = new Date();
    
    await collection.updateOne(
      { id: userId, tenantId },
      {
        $push: { roles: role },
        $set: { updatedAt: now },
      }
    );
  }
  
  /**
   * Remove role from user
   */
  async removeRole(
    userId: string,
    tenantId: string,
    roleName: string,
    context?: string
  ): Promise<void> {
    const collection = this.getCollection();
    const now = new Date();
    
    const user = await this.findById(userId, tenantId);
    if (!user) {
      throw new Error(`User "${userId}" not found`);
    }
    
    const roles = (user.roles || []).filter(
      (r) => !(r.role === roleName && r.context === context)
    );
    
    await collection.updateOne(
      { id: userId, tenantId },
      {
        $set: {
          roles,
          updatedAt: now,
        },
      }
    );
  }
  
  /**
   * Query users with filters
   */
  async query(options: UserQueryOptions = {}): Promise<{ users: User[]; total: number }> {
    const collection = this.getCollection();
    const { filter = {}, sort, pagination } = options;
    
    // Build query
    const query: any = {};
    
    if (filter.tenantId) query.tenantId = filter.tenantId;
    if (filter.status) {
      query.status = Array.isArray(filter.status)
        ? { $in: filter.status }
        : filter.status;
    }
    if (filter.emailVerified !== undefined) query.emailVerified = filter.emailVerified;
    if (filter.phoneVerified !== undefined) query.phoneVerified = filter.phoneVerified;
    if (filter.twoFactorEnabled !== undefined) query.twoFactorEnabled = filter.twoFactorEnabled;
    
    if (filter.createdAfter || filter.createdBefore) {
      query.createdAt = {};
      if (filter.createdAfter) query.createdAt.$gte = filter.createdAfter;
      if (filter.createdBefore) query.createdAt.$lte = filter.createdBefore;
    }
    
    // Role filter
    if (filter.roles && filter.roles.length > 0) {
      query['roles.role'] = { $in: filter.roles };
      if (filter.context) {
        query['roles.context'] = filter.context;
      }
    }
    
    // Metadata filter
    if (filter.metadata) {
      for (const [key, value] of Object.entries(filter.metadata)) {
        query[`metadata.${key}`] = value;
      }
    }
    
    // Build sort
    const sortOptions: any = {};
    if (sort) {
      sortOptions[sort.field] = sort.direction === 'asc' ? 1 : -1;
    } else {
      sortOptions.createdAt = -1; // Default: newest first
    }
    
    // Get total count
    const total = await collection.countDocuments(query);
    
    // Build cursor
    let cursor = collection.find(query).sort(sortOptions);
    
    // Apply pagination
    if (pagination) {
      cursor = cursor.skip(pagination.offset).limit(pagination.limit);
    }
    
    const users = await cursor.toArray();
    
    return {
      users: users as User[],
      total,
    };
  }
  
  /**
   * Delete user (soft delete)
   */
  async delete(userId: string, tenantId: string): Promise<void> {
    const collection = this.getCollection();
    const now = new Date();
    
    await collection.updateOne(
      { id: userId, tenantId },
      {
        $set: {
          status: 'deleted',
          deletedAt: now,
          updatedAt: now,
        },
      }
    );
  }
  
  /**
   * Hard delete user (permanent)
   */
  async hardDelete(userId: string, tenantId: string): Promise<void> {
    const collection = this.getCollection();
    await collection.deleteOne({ id: userId, tenantId });
  }
  
  /**
   * Update last login timestamp
   */
  async updateLastLogin(userId: string, tenantId: string): Promise<void> {
    const collection = this.getCollection();
    const now = new Date();
    
    await collection.updateOne(
      { id: userId, tenantId },
      {
        $set: {
          lastLoginAt: now,
          lastActiveAt: now,
          updatedAt: now,
        },
      }
    );
  }
  
  /**
   * Update last active timestamp
   */
  async updateLastActive(userId: string, tenantId: string): Promise<void> {
    const collection = this.getCollection();
    const now = new Date();
    
    await collection.updateOne(
      { id: userId, tenantId },
      {
        $set: {
          lastActiveAt: now,
          updatedAt: now,
        },
      }
    );
  }
}
