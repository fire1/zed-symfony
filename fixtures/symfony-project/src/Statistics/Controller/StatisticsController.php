<?php

namespace App\Controller;

use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

class StatisticsController extends AbstractController
{
    #[Route('/stats', name: 'app_statistics')]
    public function personal(): Response
    {
        return $this->render('@Statistics/personal/user.twig', [
            'user' => null,
        ]);
    }
}
