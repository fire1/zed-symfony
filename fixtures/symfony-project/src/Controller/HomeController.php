<?php

namespace App\Controller;

use App\Entity\User;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

class HomeController extends AbstractController
{
    #[Route('/', name: 'app_home')]
    public function index(EntityManagerInterface $em): Response
    {
        $users = $em->getRepository(User::class)->findActiveUsers();

        return $this->render('home/index.html.twig', [
            'users' => $users,
        ]);
    }

    #[Route('/redirect', name: 'app_redirect')]
    public function redirectExample(): Response
    {
        return $this->redirectToRoute('app_home');
    }

    public function serviceExample(): Response
    {
        $mailer = $this->container->get('mailer.mailer');

        return $this->generateUrl('app_home');
    }
}
