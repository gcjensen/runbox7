Cypress.Commands.add('closeWelcomeDialog', () => {
    cy.get('confirm-dialog').should('contain', 'Welcome to Runbox 7');
    cy.get('confirm-dialog .mat-dialog-actions button').contains('cancel').click();
});
