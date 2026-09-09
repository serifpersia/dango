import React from 'react'
import GenericModal from './GenericModal'
import { Button } from './Button'

interface MatureConsentModalProps {
  isOpen: boolean
  onClose: () => void
  onGrant: () => void
}

const MatureConsentModal: React.FC<MatureConsentModalProps> = ({ isOpen, onClose, onGrant }) => (
  <GenericModal isOpen={isOpen} title="Content Warning" onClose={onClose}>
    <div style={{ padding: '1rem', textAlign: 'center' }}>
      <p>This title contains mature content intended for adult audiences.</p>
      <p>
        By proceeding, you confirm that you are <strong>18 years of age or older</strong> (or the
        age of majority in your jurisdiction) and wish to view this content.
      </p>
      <div
        style={{
          marginTop: '1rem',
          display: 'flex',
          gap: '10px',
          justifyContent: 'center',
        }}
      >
        <Button variant="secondary" onClick={onClose}>
          Go Back
        </Button>
        <Button onClick={onGrant}>I&apos;m 18+, Continue</Button>
      </div>
    </div>
  </GenericModal>
)

export default MatureConsentModal
