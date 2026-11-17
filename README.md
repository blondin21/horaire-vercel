# Horaires de passage : natation, vélo et course à pied

Application web pour calculer les horaires de passage de groupes sur un ou plusieurs parcours. Elle est conçue pour être déployée sur **Vercel**. Les données des parcours et les fichiers GPX sont enregistrés dans un magasin **Vercel Blob privé**.

## Fonctionnalités

- Onglets Natation, Vélo, Course à pied et Restitution globale.
- Groupes avec départ, vitesse ou allure, points de passage et transitions T1/T2.
- Traces GPX facultatives, carte et curseur horaire dans les vues de restitution.
- Exports de tableaux et chronologies en XLSX ou PNG.
- Sauvegarde automatique et code facultatif pour protéger les modifications.

## Déployer sur Vercel

1. Ajoute le projet à un dépôt Git, puis importe ce dépôt dans Vercel (ou lance `npx vercel` depuis ce dossier).
2. Dans les réglages du projet Vercel, crée un magasin **Blob** avec l’accès **Private** et relie-le au projet. Vercel fournit alors les variables d’environnement nécessaires au SDK.
3. Pour protéger les modifications, ajoute `EDIT_CODE` dans **Settings > Environment Variables**, puis redéploie. Sans cette variable, les visiteurs peuvent créer, modifier et supprimer les parcours.

Le site est servi depuis `public/`. Les fonctions API se trouvent dans `api/` et utilisent Vercel Blob privé. Les fichiers GPX envoyés sont limités à 3,5 Mo pour rester sous la limite de taille des requêtes Vercel.

## Lancer en local

Relie le projet avec la CLI Vercel, puis lance :

```sh
npm install
npm run dev
```

Pour utiliser Blob en local, lie le magasin au projet Vercel afin que la CLI récupère ses variables d’environnement, ou fournis les identifiants du magasin dans l’environnement local. Configure aussi `EDIT_CODE` si tu veux tester la protection des écritures.

## Structure

- `public/index.html` : interface complète de l’application.
- `api/routes.js` et `api/routes/[...path].js` : routes HTTP `/api/routes`.
- `lib/routes-handler.js` : logique API et accès au stockage Blob.
- `package.json` : SDK Vercel Blob et CLI.

## Données et services externes

Les parcours sont stockés comme fichiers JSON et les GPX dans Vercel Blob. Les données déjà enregistrées dans Netlify Blobs ne sont pas transférées automatiquement : il faut les exporter de Netlify puis les importer séparément dans le nouveau stockage.

Le fond de carte utilise Leaflet et OpenStreetMap/IGN. Les exports XLSX chargent SheetJS depuis cdnjs ; si ce script ne se charge pas, l’application propose un export CSV.
