<?php

namespace App\WorkTackle\Repository;

use App\WorkTackle\Entity\WorkTimelineEntity;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;

/**
 * @extends ServiceEntityRepository<WorkTimelineEntity>
 */
class WorkTimelineRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, WorkTimelineEntity::class);
    }

    public function findPersonalUserStatistic(mixed $user, mixed $date): array
    {
        return [];
    }
}
