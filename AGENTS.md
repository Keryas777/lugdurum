# AGENTS.md — App Lugdurum

## Règles générales

- Préserver l'identité de marque Lugdurum.
- Ne pas modifier les parfums, prix, volumes, textes commerciaux ou données produits sans demande explicite.
- Ne pas renommer les clés JSON existantes sans demande explicite.
- Ne pas supprimer de données sans demande explicite.
- Ne pas réécrire entièrement un fichier si une modification ciblée suffit.
- Préférer les petits patchs faciles à relire.
- Toujours expliquer clairement le diff final.

## Données produits

- Les données produits sont sensibles : parfums, ingrédients, descriptions, prix, formats, disponibilité.
- Ne pas inventer de nouveaux produits.
- Ne pas modifier les textes de vente sans validation.
- Préserver les formats existants.

## Interface

- Priorité à l'affichage mobile.
- Ne pas changer les couleurs, polices, visuels ou éléments de marque sans instruction claire.
- Préserver la lisibilité et la cohérence visuelle.

## Vérifications attendues

Après modification :

- vérifier que les données produits s'affichent toujours correctement ;
- vérifier qu'aucune clé utilisée par l'application n'a été renommée ;
- signaler toute zone risquée ;
- fournir un résumé des fichiers modifiés.