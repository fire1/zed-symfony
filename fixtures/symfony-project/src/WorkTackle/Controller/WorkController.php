<?php

namespace App\WorkTackle\Controller;

use App\WorkTackle\Entity\WorkTimelineEntity;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Response;

class WorkController extends AbstractController
{
    public function stats(): Response
    {
        $work = $this->em()->getRepository(WorkTimelineEntity::class)->findPersonalUserStatistic(null, null);

        return new Response((string) count($work));
    }

    private function em(): \Doctrine\ORM\EntityManagerInterface
    {
        throw new \LogicException('fixture');
    }
}
