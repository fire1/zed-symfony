<?php

namespace App\WorkTackle\Entity;

use App\WorkTackle\Repository\WorkTimelineRepository;
use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity(repositoryClass: WorkTimelineRepository::class)]
class WorkTimelineEntity
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column]
    private ?int $id = null;
}
