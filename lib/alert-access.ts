export function receivesAlert(actorAddress:string,facility:{lenderAddress:string;borrowerAddress:string},audience:string):boolean {
  const address=actorAddress.toLowerCase();
  return (address===facility.lenderAddress.toLowerCase() && ['lender','both'].includes(audience)) ||
    (address===facility.borrowerAddress.toLowerCase() && ['borrower','both'].includes(audience));
}
