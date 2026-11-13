import { createMemoryTaskRepository } from './memory-task-repository';
import { taskRepositoryContract } from './task-repository.contract';

taskRepositoryContract('内存', createMemoryTaskRepository);
