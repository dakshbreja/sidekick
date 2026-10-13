// Internal service binding only; never an HTTP owner-selection endpoint.
import {WorkerEntrypoint} from 'cloudflare:workers';
export class ConnectorBackend extends WorkerEntrypoint {
  #student(owner) {
    if(this.env.CONNECTOR_ENABLED!=='true'||typeof owner!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(owner))throw new Error('connector_unavailable');
    return this.env.STUDENTS.getByName('student-v1:'+owner);
  }
  createGrant(owner,data){return this.#student(owner).connector({owner,op:'create',data});}
  grantActive(owner,grantId){return this.#student(owner).connector({owner,op:'active',grantId});}
  protocol(owner,grantId,message,scopes){return this.#student(owner).connector({owner,op:'protocol',grantId,message,scopes});}
}
